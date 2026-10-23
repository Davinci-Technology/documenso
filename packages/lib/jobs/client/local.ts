import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { emailDeliveryContext } from '@documenso/email/delivery-context';
import { prisma } from '@documenso/prisma';
import { sha256 } from '@noble/hashes/sha2';
import { BackgroundJobStatus, Prisma } from '@prisma/client';
import { CronExpressionParser } from 'cron-parser';
import type { Context as HonoContext } from 'hono';

import { NEXT_PRIVATE_INTERNAL_WEBAPP_URL } from '../../constants/app';
import { sign } from '../../server-only/crypto/sign';
import { verify } from '../../server-only/crypto/verify';
import {
  type JobDefinition,
  type JobRunIO,
  type SimpleTriggerJobOptions,
  ZSimpleTriggerJobOptionsSchema,
} from './_internal/job';
import type { Json } from './_internal/json';
import { BaseJobProvider } from './base';

/**
 * Build a deterministic BackgroundJob ID for a cron run so that multiple
 * instances of the local provider racing to enqueue the same slot will
 * collide on the primary key instead of creating duplicates.
 */
const createCronRunId = (jobId: string, scheduledFor: Date): string => {
  const key = `cron:${jobId}:${scheduledFor.toISOString()}`;
  const hash = Buffer.from(sha256(key)).toString('hex').slice(0, 24);

  return `cron_${hash}`;
};

type CronJobEntry = {
  definition: JobDefinition;
  cron: string;
  lastTickAt: Date;
};

const executionContext = new AsyncLocalStorage<{ jobId: string; taskId?: string }>();

const LEASE_MS = 120_000;
const recoveryDelay = (attempt: number) => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 300_000);

const CRON_POLL_INTERVAL_MS = 30_000; // 30 seconds
const CRON_POLL_JITTER_MS = 5_000; // 0-5 seconds random offset

export class LocalJobProvider extends BaseJobProvider {
  private static _instance: LocalJobProvider;

  private _jobDefinitions: Record<string, JobDefinition> = {};
  private _cronJobs: CronJobEntry[] = [];
  private _cronPoller: NodeJS.Timeout | null = null;

  private constructor() {
    super();
  }

  static getInstance() {
    if (!LocalJobProvider._instance) {
      LocalJobProvider._instance = new LocalJobProvider();
    }

    return LocalJobProvider._instance;
  }

  public defineJob<N extends string, T>(definition: JobDefinition<N, T>) {
    this._jobDefinitions[definition.id] = {
      ...definition,
      enabled: definition.enabled ?? true,
    };

    if (definition.trigger.cron && definition.enabled !== false) {
      const alreadyRegistered = this._cronJobs.some((job) => job.definition.id === definition.id);

      if (!alreadyRegistered) {
        this._cronJobs.push({
          definition: {
            ...definition,
            enabled: definition.enabled ?? true,
          },
          cron: definition.trigger.cron,
          lastTickAt: new Date(),
        });

        console.log(`[JOBS]: Registered cron job ${definition.id} (${definition.trigger.cron})`);
      }
    }
  }

  /**
   * Start the single cron poller for all registered cron jobs.
   *
   * Must be called explicitly at application startup after all jobs have been
   * defined. The poller runs every 30 seconds (+ random jitter to avoid
   * thundering herd across instances) and evaluates all registered cron jobs
   * for due slots.
   *
   * For each due slot it creates a BackgroundJob row with a deterministic ID.
   * If the insert succeeds the job is dispatched; if it fails with a unique
   * constraint violation (P2002) another instance already claimed that slot.
   */
  public override startCron() {
    if (this._cronPoller) {
      return;
    }

    const tick = () => {
      const jitter = Math.floor(Math.random() * CRON_POLL_JITTER_MS);

      this._cronPoller = setTimeout(() => {
        void this.processCronTick()
          .then(() => this.recoverJobs())
          .catch(() => {
            console.error('[JOBS_ALERT] Recovery sweep failed');
          })
          .finally(tick);
      }, CRON_POLL_INTERVAL_MS + jitter);
    };

    void this.recoverJobs().catch(() => console.error('[JOBS_ALERT] Initial recovery failed'));
    tick();

    console.log(`[JOBS]: Started cron poller for ${this._cronJobs.length} job(s)`);
  }

  private async processCronTick() {
    for (const cronJob of this._cronJobs) {
      try {
        const dueSlots = this.getDueCronSlots(cronJob);

        cronJob.lastTickAt = new Date();

        if (dueSlots.length === 0) {
          continue;
        }

        // Only take the latest slot — sweep-style jobs don't need to catch up
        // every missed slot after downtime, just the most recent one.
        const scheduledFor = dueSlots[dueSlots.length - 1];
        const deterministicId = createCronRunId(cronJob.definition.id, scheduledFor);

        const pendingJob = await prisma.backgroundJob
          .create({
            data: {
              id: deterministicId,
              jobId: cronJob.definition.id,
              name: cronJob.definition.name,
              version: cronJob.definition.version,
              payload: { scheduledFor: scheduledFor.toISOString() },
            },
          })
          .catch((error: unknown) => {
            // P2002 = unique constraint violation — another instance already enqueued this slot.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              return null;
            }

            throw error;
          });

        if (!pendingJob) {
          continue;
        }

        await this.submitJobToEndpoint({
          jobId: pendingJob.id,
          jobDefinitionId: pendingJob.jobId,
          data: {
            name: cronJob.definition.trigger.name,
            payload: { scheduledFor: scheduledFor.toISOString() },
          },
          isRetry: false,
        });
      } catch (error) {
        console.error(`[JOBS]: Cron tick failed for ${cronJob.definition.id}`, error);
      }
    }
  }

  // Claims in the API handler are atomic, so duplicate dispatches are harmless.
  // Old PROCESSING rows pre-dating leases are recovered after the same timeout.
  public async recoverJobs() {
    const now = new Date();
    const stale = await prisma.backgroundJob.findMany({
      where: {
        status: BackgroundJobStatus.PROCESSING,
        OR: [
          { leaseExpiresAt: { lt: now } },
          { leaseExpiresAt: null, updatedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
        ],
      },
      take: 100,
    });
    for (const job of stale) {
      const legacyUnfenced = !job.leaseOwner;
      const exhausted = job.retried >= job.maxRetries || legacyUnfenced;
      await prisma.backgroundJob.updateMany({
        where: {
          id: job.id,
          status: BackgroundJobStatus.PROCESSING,
          leaseOwner: job.leaseOwner,
          updatedAt: job.updatedAt,
        },
        data: {
          status: exhausted ? BackgroundJobStatus.FAILED : BackgroundJobStatus.PENDING,
          leaseOwner: null,
          leaseExpiresAt: null,
          availableAt: new Date(now.getTime() + recoveryDelay(job.retried)),
          lastError: legacyUnfenced
            ? 'LEGACY_JOB_RECONCILIATION_REQUIRED'
            : exhausted
              ? 'RECOVERY_RETRIES_EXHAUSTED'
              : 'WORKER_LEASE_EXPIRED',
          completedAt: exhausted ? now : null,
        },
      });
      console.error('[JOBS_ALERT]', {
        jobId: job.id,
        reason: legacyUnfenced
          ? 'LEGACY_JOB_RECONCILIATION_REQUIRED'
          : exhausted
            ? 'RECOVERY_RETRIES_EXHAUSTED'
            : 'WORKER_LEASE_EXPIRED',
      });
    }
    const pending = await prisma.backgroundJob.findMany({
      where: { status: BackgroundJobStatus.PENDING, availableAt: { lte: now } },
      orderBy: { availableAt: 'asc' },
      take: 50,
    });
    await Promise.all(
      pending.map(async (job) => {
        if (
          job.lastError === null &&
          /send|email|reminder/.test(job.jobId) &&
          (job.retried > 0 || job.availableAt.getTime() - job.submittedAt.getTime() > 1000)
        ) {
          await prisma.backgroundJob.updateMany({
            where: { id: job.id, status: BackgroundJobStatus.PENDING, lastError: null },
            data: {
              status: BackgroundJobStatus.FAILED,
              lastError: 'LEGACY_MAIL_RECONCILIATION_REQUIRED',
              completedAt: now,
            },
          });
          console.error('[JOBS_ALERT]', { jobId: job.id, reason: 'LEGACY_MAIL_RECONCILIATION_REQUIRED' });
          return;
        }
        const definition = this._jobDefinitions[job.jobId];
        if (definition?.enabled) {
          await this.submitJobToEndpoint({
            jobId: job.id,
            jobDefinitionId: job.jobId,
            data: { name: definition.trigger.name, payload: job.payload },
          });
        }
      }),
    );
  }

  /**
   * Use cron-parser to find all cron slots that are due between the last tick
   * and now.
   */
  private getDueCronSlots(cronJob: CronJobEntry): Date[] {
    const expr = CronExpressionParser.parse(cronJob.cron, {
      currentDate: cronJob.lastTickAt,
    });

    const now = new Date();
    const slots: Date[] = [];

    let next = expr.next();

    while (next.toDate() <= now) {
      slots.push(next.toDate());
      next = expr.next();
    }

    return slots;
  }

  public async triggerJob(options: SimpleTriggerJobOptions) {
    const parent = executionContext.getStore();
    if (parent && !options.id) {
      // Global jobs.triggerJob calls in production handler tails must inherit the
      // same receipt identity as io.triggerJob, independent of lease/attempt.
      options = {
        ...options,
        id: JSON.stringify([parent.jobId, parent.taskId ?? 'handler', options.name, options.payload]),
      };
    }
    const eligibleJobs = Object.values(this._jobDefinitions).filter((job) => job.trigger.name === options.name);

    await Promise.all(
      eligibleJobs.map(async (job) => {
        // Ideally we will change this to a createMany with returning later once we upgrade Prisma
        // @see: https://github.com/prisma/prisma/releases/tag/5.14.0
        const pendingJob = await prisma.backgroundJob
          .create({
            data: {
              id: options.id ? `child_${Buffer.from(sha256(`${options.id}:${job.id}`)).toString('hex')}` : undefined,
              jobId: job.id,
              name: job.name,
              version: job.version,
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              payload: options.payload as Prisma.InputJsonValue,
            },
          })
          .catch((error: unknown) => {
            if (options.id && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              return null;
            }
            throw error;
          });
        if (!pendingJob) {
          return;
        }

        await this.submitJobToEndpoint({
          jobId: pendingJob.id,
          jobDefinitionId: pendingJob.jobId,
          data: options,
          isRetry: false,
        });
      }),
    );
  }

  public getApiHandler(): (c: HonoContext) => Promise<Response | void> {
    return async (c: HonoContext) => {
      const req = c.req;

      if (req.method !== 'POST') {
        return c.text('Method not allowed', 405);
      }

      const jobId = req.header('x-job-id');
      const signature = req.header('x-job-signature');

      const options = await req
        .json()
        .then(async (data) => ZSimpleTriggerJobOptionsSchema.parseAsync(data))
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        .then((data) => data as SimpleTriggerJobOptions)
        .catch(() => null);

      if (!options) {
        return c.text('Bad request', 400);
      }

      const definition = this._jobDefinitions[options.name];

      if (typeof jobId !== 'string' || typeof signature !== 'string' || typeof options !== 'object') {
        return c.text('Bad request', 400);
      }

      if (!definition) {
        return c.text('Job not found', 404);
      }

      if (definition && !definition.enabled) {
        console.log('Attempted to trigger a disabled job', options.name);

        return c.text('Job not found', 404);
      }

      let isVerified = false;
      try {
        isVerified = Boolean(signature) && verify(options, signature);
      } catch {
        // Malformed encrypted signatures are authentication failures.
      }
      if (!isVerified) {
        return c.text('Unauthorized', 401);
      }

      let payload = options.payload;

      if (definition.trigger.schema) {
        const result = definition.trigger.schema.safeParse(payload);

        if (!result.success) {
          return c.text('Bad request', 400);
        }

        payload = result.data;
      }

      console.info('[JOBS]: Claiming job', { jobId, definitionId: definition.id });
      const leaseOwner = randomUUID();

      let backgroundJob = await prisma.backgroundJob
        .update({
          where: {
            id: jobId,
            jobId: definition.id,
            payload: {
              equals: options.payload === null ? Prisma.JsonNull : (options.payload as Prisma.InputJsonValue),
            },
            status: BackgroundJobStatus.PENDING,
            availableAt: { lte: new Date() },
          },
          data: {
            status: BackgroundJobStatus.PROCESSING,
            retried: { increment: 1 },
            lastRetriedAt: new Date(),
            leaseOwner,
            leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          },
        })
        .catch(() => null);

      if (!backgroundJob) {
        return c.text('Job not found', 404);
      }

      const heartbeat = setInterval(() => {
        void prisma.backgroundJob
          .updateMany({
            where: { id: jobId, status: BackgroundJobStatus.PROCESSING, leaseOwner },
            data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
          })
          .catch(() => console.error('[JOBS_ALERT] Lease heartbeat failed', { jobId }));
      }, 30_000);
      heartbeat.unref();
      try {
        await executionContext.run({ jobId }, () =>
          emailDeliveryContext.run({ jobId, sequence: 0 }, () =>
            definition.handler({
              payload,
              io: this.createJobRunIO(jobId, leaseOwner),
            }),
          ),
        );

        backgroundJob = await prisma.backgroundJob.update({
          where: {
            id: jobId,
            status: BackgroundJobStatus.PROCESSING,
            leaseOwner,
          },
          data: {
            status: BackgroundJobStatus.COMPLETED,
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: new Date(),
          },
        });
      } catch (error) {
        console.error('[JOBS_ALERT] Job failed', { jobId, definitionId: definition.id });

        const taskHasExceededRetries = error instanceof BackgroundTaskExceededRetriesError;
        const jobHasExceededRetries = backgroundJob.retried >= backgroundJob.maxRetries;

        if (taskHasExceededRetries || jobHasExceededRetries) {
          backgroundJob = await prisma.backgroundJob.update({
            where: {
              id: jobId,
              status: BackgroundJobStatus.PROCESSING,
              leaseOwner,
            },
            data: {
              status: BackgroundJobStatus.FAILED,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastError: 'RETRIES_EXHAUSTED',
              completedAt: new Date(),
            },
          });

          return c.text('Task exceeded retries', 500);
        }

        backgroundJob = await prisma.backgroundJob.update({
          where: {
            id: jobId,
            status: BackgroundJobStatus.PROCESSING,
            leaseOwner,
          },
          data: {
            status: BackgroundJobStatus.PENDING,
            leaseOwner: null,
            leaseExpiresAt: null,
            availableAt: new Date(Date.now() + recoveryDelay(backgroundJob.retried)),
            lastError: 'HANDLER_FAILED',
          },
        });
      } finally {
        clearInterval(heartbeat);
      }

      return c.text('OK', 200);
    };
  }

  private async submitJobToEndpoint(options: {
    jobId: string;
    jobDefinitionId: string;
    data: SimpleTriggerJobOptions;
    isRetry?: boolean;
  }) {
    const { jobId, jobDefinitionId, isRetry } = options;
    // The receiver validates before verifying. Sign the same schema-ordered
    // representation, including IDs introduced by durable parent receipts.
    const data = ZSimpleTriggerJobOptionsSchema.parse(options.data);

    const endpoint = `${NEXT_PRIVATE_INTERNAL_WEBAPP_URL()}/api/jobs/${jobDefinitionId}/${jobId}`;
    const signature = sign(data);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Job-Id': jobId,
      'X-Job-Signature': signature,
    };

    if (isRetry) {
      headers['X-Job-Retry'] = '1';
    }

    console.log('Submitting job to endpoint:', endpoint);
    await Promise.race([
      fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(data),
        headers,
      }).catch(() => null),
      new Promise((resolve) => {
        setTimeout(resolve, 150);
      }),
    ]);
  }

  private createJobRunIO(jobId: string, leaseOwner: string): JobRunIO {
    return {
      runTask: async <T extends void | Json>(cacheKey: string, callback: () => Promise<T>) => {
        const ownsLease = await prisma.backgroundJob.count({
          where: {
            id: jobId,
            status: BackgroundJobStatus.PROCESSING,
            leaseOwner,
            leaseExpiresAt: { gt: new Date() },
          },
        });
        if (!ownsLease) {
          throw new BackgroundTaskFailedError('Worker lease expired');
        }
        const hashedKey = Buffer.from(sha256(cacheKey)).toString('hex');

        let task = await prisma.backgroundJobTask.findFirst({
          where: {
            id: `task-${hashedKey}--${jobId}`,
            jobId,
          },
        });

        if (!task) {
          task = await prisma.backgroundJobTask.create({
            data: {
              id: `task-${hashedKey}--${jobId}`,
              name: cacheKey,
              jobId,
              status: BackgroundJobStatus.PENDING,
            },
          });
        }

        if (task.status === BackgroundJobStatus.COMPLETED) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          return task.result as T;
        }

        if (task.retried >= 3) {
          throw new BackgroundTaskExceededRetriesError('Task exceeded retries');
        }

        const taskId = task.id;
        try {
          const result = await executionContext.run({ jobId, taskId }, () =>
            emailDeliveryContext.run({ jobId, taskId, sequence: 0 }, callback),
          );

          task = await prisma.backgroundJobTask.update({
            where: {
              id: task.id,
              jobId,
            },
            data: {
              status: BackgroundJobStatus.COMPLETED,
              result: result === null ? Prisma.JsonNull : result,
              completedAt: new Date(),
            },
          });

          return result;
        } catch (_err) {
          task = await prisma.backgroundJobTask.update({
            where: {
              id: task.id,
              jobId,
            },
            data: {
              status: BackgroundJobStatus.PENDING,
              retried: {
                increment: 1,
              },
            },
          });

          console.error('[JOBS_ALERT] Task failed', { jobId, taskId: task.id });

          throw new BackgroundTaskFailedError('Task failed');
        }
      },
      triggerJob: async (cacheKey, payload) => await this.triggerJob({ ...payload, id: `${jobId}:${cacheKey}` }),
      logger: {
        debug: (...args) => console.debug(`[${jobId}]`, ...args),
        error: (...args) => console.error(`[${jobId}]`, ...args),
        info: (...args) => console.info(`[${jobId}]`, ...args),
        log: (...args) => console.log(`[${jobId}]`, ...args),
        warn: (...args) => console.warn(`[${jobId}]`, ...args),
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      wait: async () => {
        throw new Error('Not implemented');
      },
    };
  }
}

class BackgroundTaskFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackgroundTaskFailedError';
  }
}

class BackgroundTaskExceededRetriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackgroundTaskExceededRetriesError';
  }
}
