import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  backgroundJob: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  backgroundJobTask: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('@documenso/prisma', () => ({ prisma: db }));
vi.mock('../../server-only/crypto/verify', () => ({ verify: vi.fn(() => true) }));
vi.mock('../../server-only/crypto/sign', () => ({ sign: vi.fn(() => 'test-signature') }));
vi.mock('../../constants/app', () => ({ NEXT_PRIVATE_INTERNAL_WEBAPP_URL: () => 'http://sink.example' }));

import { LocalJobProvider } from './local';

const provider = LocalJobProvider.getInstance();
const handler = vi.fn();
provider.defineJob({ id: 'test.recover', name: 'Test', version: '1', trigger: { name: 'test.recover' }, handler });
const app = new Hono();
app.post('/jobs', provider.getApiHandler());
const dispatch = () =>
  app.request('/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-job-id': 'job1',
      'x-job-signature': 'valid',
    },
    body: JSON.stringify({ name: 'test.recover', payload: { opaqueId: 'record1' } }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  db.backgroundJob.update.mockResolvedValue({ id: 'job1', jobId: 'test.recover', retried: 1, maxRetries: 3 });
  db.backgroundJob.count.mockResolvedValue(1);
  handler.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('OK')));
});

describe('durable local recovery', () => {
  it('recovers stale processing rows and redispatches due persisted payloads', async () => {
    db.backgroundJob.findMany
      .mockResolvedValueOnce([
        { id: 'stale1', jobId: 'test.recover', retried: 1, maxRetries: 3, leaseOwner: 'old', updatedAt: new Date(0) },
      ])
      .mockResolvedValueOnce([{ id: 'pending1', jobId: 'test.recover', payload: { opaqueId: 'record1' } }]);
    await provider.recoverJobs();
    expect(db.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'stale1', leaseOwner: 'old' }),
        data: expect.objectContaining({ status: 'PENDING', leaseOwner: null, lastError: 'WORKER_LEASE_EXPIRED' }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://sink.example/api/jobs/test.recover/pending1',
      expect.objectContaining({
        body: JSON.stringify({ name: 'test.recover', payload: { opaqueId: 'record1' } }),
      }),
    );
  });
  it('marks repeated crashes terminal rather than retrying without a bound', async () => {
    db.backgroundJob.findMany
      .mockResolvedValueOnce([
        { id: 'stale1', jobId: 'test.recover', retried: 3, maxRetries: 3, leaseOwner: 'old', updatedAt: new Date(0) },
      ])
      .mockResolvedValueOnce([]);
    await provider.recoverJobs();
    expect(db.backgroundJob.updateMany.mock.calls[0][0].data.status).toBe('FAILED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('claims atomically and rejects duplicate dispatch without rerunning a handler', async () => {
    expect((await dispatch()).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    db.backgroundJob.update.mockRejectedValueOnce(new Error('already claimed'));
    expect((await dispatch()).status).toBe(404);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(db.backgroundJob.update.mock.calls[0][0]).toMatchObject({
      where: { status: 'PENDING', jobId: 'test.recover' },
      data: { retried: { increment: 1 } },
    });
  });
  it('persists delayed retry after failure rather than recursively resubmitting', async () => {
    handler.mockRejectedValue(new Error('temporary outage'));
    const before = Date.now();
    expect((await dispatch()).status).toBe(200);
    const retry = db.backgroundJob.update.mock.calls.at(-1)?.[0].data;
    expect(retry.status).toBe('PENDING');
    expect(retry.availableAt.getTime()).toBeGreaterThanOrEqual(before + 30000);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not reexecute already completed tasks and fences stale workers', async () => {
    const task = vi.fn();
    handler.mockImplementation(async ({ io }) => {
      await io.runTask('cached', task);
    });
    db.backgroundJobTask.findFirst.mockResolvedValue({ id: 'cached1', status: 'COMPLETED', result: { done: true } });
    expect((await dispatch()).status).toBe(200);
    expect(task).not.toHaveBeenCalled();
    db.backgroundJob.count.mockResolvedValue(0);
    expect((await dispatch()).status).toBe(200);
    expect(task).not.toHaveBeenCalled();
  });
});

it('quarantines legacy in-flight mail lacking a submission ledger', async () => {
  db.backgroundJob.findMany
    .mockResolvedValueOnce([
      {
        id: 'legacy-mail',
        jobId: 'send.signing.requested.email',
        retried: 1,
        maxRetries: 3,
        leaseOwner: null,
        updatedAt: new Date(0),
      },
    ])
    .mockResolvedValueOnce([]);
  await provider.recoverJobs();
  expect(db.backgroundJob.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', lastError: 'LEGACY_MAIL_RECONCILIATION_REQUIRED' }),
    }),
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('uses stable child job IDs so parent retries cannot duplicate notification jobs', async () => {
  db.backgroundJob.create.mockResolvedValue({ id: 'child1', jobId: 'test.recover' });
  await provider.triggerJob({ id: 'parent:task-key', name: 'test.recover', payload: {} });
  const firstId = db.backgroundJob.create.mock.calls[0][0].data.id;
  await provider.triggerJob({ id: 'parent:task-key', name: 'test.recover', payload: {} });
  expect(db.backgroundJob.create.mock.calls[1][0].data.id).toBe(firstId);
  await provider.triggerJob({ id: 'parent:different-task', name: 'test.recover', payload: {} });
  expect(db.backgroundJob.create.mock.calls[2][0].data.id).not.toBe(firstId);
});
