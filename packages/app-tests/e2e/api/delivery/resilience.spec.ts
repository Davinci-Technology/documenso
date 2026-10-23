import { createHash, createHmac, randomUUID, sign as signEvent } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';
import { emailDeliveryContext } from '@documenso/email/delivery-context';
import { withDeliveryTracking } from '@documenso/email/tracked-transport';
import { sign } from '@documenso/lib/server-only/crypto/sign';
import { prisma } from '@documenso/prisma';
import { expect } from '@playwright/test';
import { Hono } from 'hono';
import { setSignedCookie } from 'hono/cookie';
import { createTransport } from 'nodemailer';

import { cacheTask, createParent, seedEnvelope, startSmtpSink, test } from './fixtures';

test('SMTP loss of final DATA acknowledgement quarantines the intent; explicit451 can retry', async ({ runtime }) => {
  const transport = withDeliveryTracking(
    createTransport({
      host: '127.0.0.1',
      port: runtime.smtp.port,
      ignoreTLS: true,
      connectionTimeout: 2000,
      socketTimeout: 2000,
    }),
  );
  const mail = {
    from: 'sender@invalid.test',
    to: 'recipient@invalid.test',
    subject: 'Synthetic local regression',
    text: 'Synthetic sink only',
  };
  const jobId = randomUUID();
  const send = () =>
    emailDeliveryContext.run({ jobId, taskId: 'same-intent', sequence: 0 }, () => transport.sendMail(mail));
  try {
    runtime.smtp.setMode('drop-ack');
    await expect(send()).rejects.toThrow('EMAIL_DELIVERY_AMBIGUOUS');
    await expect(send()).rejects.toThrow('RECONCILIATION');
    expect(runtime.smtp.counts()).toEqual({ bodies: 1, accepted: 1 });
    expect((await prisma.emailDelivery.findFirstOrThrow({ where: { jobId } })).status).toBe('AMBIGUOUS');
    runtime.smtp.setMode('temporary');
    const retryJob = randomUUID();
    const sendRetry = () => emailDeliveryContext.run({ jobId: retryJob, sequence: 0 }, () => transport.sendMail(mail));
    await expect(sendRetry()).rejects.toThrow('EMAIL_DELIVERY_RETRYABLE');
    await sendRetry();
    expect(runtime.smtp.counts()).toEqual({ bodies: 3, accepted: 2 });
    expect((await prisma.emailDelivery.findFirstOrThrow({ where: { jobId: retryJob } })).status).toBe('ACCEPTED');
  } finally {
    transport.close();
  }
});

const signedDispatch = (url: string, parent: { id: string; jobId: string; payload: unknown }) => {
  const options = { name: parent.jobId, payload: parent.payload };
  return fetch(`${url}/api/jobs/${parent.jobId}/${parent.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-job-id': parent.id,
      'x-job-signature': sign(options),
    },
    body: JSON.stringify(options),
  });
};

const failParentCompletion = async (parentId: string) => {
  const name = `delivery_fault_${parentId.replaceAll('-', '')}`;
  // A real database failure at the final commit reproduces the persistence
  // boundary after a production handler has already enqueued its children.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id = '${parentId}' AND NEW.status = 'COMPLETED' THEN RAISE EXCEPTION 'synthetic parent final commit failure'; END IF;
    RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER "${name}" BEFORE UPDATE ON "BackgroundJob" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "BackgroundJob"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
  };
};

test('actual seal and expiry handler tails reuse mail and webhook children after a failed parent commit', async ({
  runtime,
}) => {
  for (const kind of ['seal', 'expiry']) {
    const seeded = await seedEnvelope(runtime.callbackUrl);
    const payload = kind === 'seal' ? { documentId: seeded.user.id } : { recipientId: seeded.recipient.id };
    const parent = await createParent(
      kind === 'seal' ? 'internal.seal-document' : 'internal.process-recipient-expired',
      payload,
    );
    if (kind === 'seal') {
      await cacheTask(parent.id, 'seal-document', {
        envelopeId: seeded.envelope.id,
        envelopeStatus: 'COMPLETED',
        isRejected: false,
      });
    } else {
      await prisma.envelope.update({ where: { id: seeded.envelope.id }, data: { status: 'PENDING' } });
      await prisma.recipient.update({
        where: { id: seeded.recipient.id },
        data: { expiresAt: new Date(Date.now() - 60000) },
      });
    }
    const removeFault = await failParentCompletion(parent.id);
    try {
      expect((await signedDispatch(runtime.url, parent)).status).toBe(200);
      await expect
        .poll(async () => (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } })).status)
        .toBe('PENDING');
      const failed = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } });
      expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());
      await expect
        .poll(async () =>
          prisma.emailDelivery.count({
            where: {
              status: 'ACCEPTED',
              jobId: {
                in: (
                  await prisma.backgroundJob.findMany({
                    where: { payload: { path: ['envelopeId'], equals: seeded.envelope.id } },
                  })
                ).map((job) => job.id),
              },
            },
          }),
        )
        .toBe(1);
      await expect
        .poll(async () => prisma.webhookCall.count({ where: { webhookId: seeded.webhook.id, status: 'SUCCESS' } }))
        .toBe(1);
    } finally {
      await removeFault();
    }
    await prisma.backgroundJob.update({ where: { id: parent.id }, data: { availableAt: new Date() } });
    expect((await signedDispatch(runtime.url, parent)).status).toBe(200);
    expect((await signedDispatch(runtime.url, parent)).status).toBe(404);
    const children = await prisma.backgroundJob.findMany({
      where: { payload: { path: ['envelopeId'], equals: seeded.envelope.id } },
    });
    expect(children).toHaveLength(1);
    expect(await prisma.emailDelivery.count({ where: { jobId: children[0].id } })).toBe(1);
    expect(await prisma.webhookCall.count({ where: { webhookId: seeded.webhook.id } })).toBe(1);
    const callback = runtime.callbacks.find((item) => item.body.toString().includes(seeded.envelope.id));
    expect(callback).toBeDefined();
    if (!callback) {
      throw new Error('Expected the production callback to reach the local sink');
    }
    expect(callback?.headers['x-documenso-secret']).toBe('synthetic-contract-secret');
    expect(callback?.headers['x-documenso-signature']).toBe(
      `sha256=${createHmac('sha256', 'synthetic-contract-secret').update(callback.body).digest('hex')}`,
    );

    const acceptedBeforeLegacyRestart = runtime.smtp.counts().accepted;
    await prisma.backgroundJob.update({
      where: { id: parent.id },
      data: {
        status: 'PROCESSING',
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(0),
        retried: 1,
        completedAt: null,
      },
    });
    await runtime.restart();
    await expect
      .poll(async () => (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } })).lastError)
      .toBe('LEGACY_JOB_RECONCILIATION_REQUIRED');
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } })).status).toBe('FAILED');
    expect((await signedDispatch(runtime.url, parent)).status).toBe(404);
    expect(runtime.smtp.counts().accepted).toBe(acceptedBeforeLegacyRestart);
  }
});

test('leased pending recovery and signed persisted-payload binding use actual HTTP and database', async ({
  runtime,
}) => {
  const seeded = await seedEnvelope(runtime.callbackUrl);
  const parent = await prisma.backgroundJob.create({
    data: {
      id: randomUUID(),
      jobId: 'internal.process-recipient-expired',
      name: 'Synthetic stopped worker',
      version: '1.0.0',
      payload: { recipientId: seeded.recipient.id },
      status: 'PROCESSING',
      leaseOwner: 'synthetic-stopped-worker',
      leaseExpiresAt: new Date(0),
      updatedAt: new Date(0),
      retried: 1,
    },
  });
  await runtime.restart();
  await expect
    .poll(async () => (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } })).status)
    .toBe('PENDING');
  expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } })).lastError).toBe(
    'WORKER_LEASE_EXPIRED',
  );
  expect((await signedDispatch(runtime.url, parent)).status).toBe(404);
  await prisma.backgroundJob.update({ where: { id: parent.id }, data: { availableAt: new Date() } });
  const changed = { ...parent, payload: { recipientId: seeded.recipient.id + 1000 } };
  expect((await signedDispatch(runtime.url, changed)).status).toBe(404);
  const unsigned = await fetch(`${runtime.url}/api/jobs/${parent.jobId}/${parent.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-job-id': parent.id,
      'x-job-signature': 'invalid',
    },
    body: JSON.stringify({ name: parent.jobId, payload: parent.payload }),
  });
  expect(unsigned.status).toBe(401);
  expect((await signedDispatch(runtime.url, parent)).status).toBe(200);
  expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } })).status).toBe('COMPLETED');
});

const sessionCookie = async (userId: number, isEmbed: boolean) => {
  const token = randomUUID();
  const hash = createHash('sha256').update(token).digest('hex');
  await prisma.session.create({
    data: { id: hash, sessionToken: hash, userId, isEmbed, expiresAt: new Date(Date.now() + 60000) },
  });
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('Synthetic session secret was not configured');
  }
  const app = new Hono();
  app.get('/', async (c) => {
    await setSignedCookie(c, 'sessionId', token, secret);
    return c.text('');
  });
  const cookie = (await app.request('/')).headers.get('set-cookie');
  if (!cookie) {
    throw new Error('Synthetic signed session cookie was not generated');
  }
  return cookie.split(';')[0];
};

test('signed provider HTTP ingestion deduplicates outcomes and operations require a real administrator session', async ({
  runtime,
}) => {
  const seeded = await seedEnvelope(runtime.callbackUrl);
  const id = randomUUID();
  await prisma.emailDelivery.create({
    data: { id, messageId: `<${id}@invalid.test>`, envelopeId: seeded.envelope.id, status: 'ACCEPTED' },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const event = {
    sg_event_id: randomUUID(),
    davinci_delivery_id: id,
    sg_message_id: 'synthetic-provider',
    event: 'delivered',
    timestamp: Number(timestamp),
  };
  const body = JSON.stringify([event, event, { ...event, sg_event_id: randomUUID(), event: 'processed' }]);
  const signature = signEvent('sha256', Buffer.from(timestamp + body), runtime.providerPrivateKey).toString('base64');
  const headers = {
    'content-type': 'application/json',
    'x-twilio-email-event-webhook-timestamp': timestamp,
    'x-twilio-email-event-webhook-signature': signature,
  };
  const send = (data: string, values = headers) =>
    fetch(`${runtime.url}/api/webhooks/sendgrid`, { method: 'POST', headers: values, body: data });
  expect((await send(body, { ...headers, 'x-twilio-email-event-webhook-signature': '' })).status).toBe(403);
  expect((await send(`${body} `)).status).toBe(403);
  expect(
    (await send(body, { ...headers, 'x-twilio-email-event-webhook-timestamp': String(Number(timestamp) - 301) }))
      .status,
  ).toBe(403);
  expect((await send(body)).status).toBe(200);
  expect((await send(body)).status).toBe(200);
  expect(await prisma.emailDeliveryEvent.count({ where: { deliveryId: id } })).toBe(2);
  expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id } })).status).toBe('delivered');
  expect((await fetch(`${runtime.url}/api/operations/delivery`)).status).toBe(403);
  const regular = await prisma.user.create({ data: { email: `${randomUUID()}@invalid.test`, roles: ['USER'] } });
  for (const cookie of [await sessionCookie(regular.id, false), await sessionCookie(seeded.user.id, true)]) {
    expect((await fetch(`${runtime.url}/api/operations/delivery`, { headers: { cookie } })).status).toBe(403);
  }
  const response = await fetch(`${runtime.url}/api/operations/delivery`, {
    headers: { cookie: await sessionCookie(seeded.user.id, false) },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('not inbox placement');
});

test('concurrent production sweeps deduplicate one reminder occurrence and preserve the next occurrence', async ({
  runtime,
}) => {
  const seeded = await seedEnvelope(runtime.callbackUrl);
  await prisma.envelope.update({
    where: { id: seeded.envelope.id },
    data: {
      status: 'PENDING',
      documentMeta: {
        update: {
          reminderSettings: { sendAfter: { unit: 'day', amount: 1 }, repeatEvery: { unit: 'day', amount: 1 } },
        },
      },
    },
  });
  await prisma.recipient.update({
    where: { id: seeded.recipient.id },
    data: {
      sentAt: new Date(Date.now() - 6 * 86400000),
      nextReminderAt: new Date(Date.now() - 3 * 86400000),
    },
  });
  const first = await createParent('internal.send-signing-reminders-sweep', {});
  const concurrent = await createParent('internal.send-signing-reminders-sweep', {});
  const responses = await Promise.all([signedDispatch(runtime.url, first), signedDispatch(runtime.url, concurrent)]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  await expect
    .poll(async () => (await prisma.recipient.findUniqueOrThrow({ where: { id: seeded.recipient.id } })).reminderCount)
    .toBe(1);
  const children = () =>
    prisma.backgroundJob.findMany({
      where: {
        jobId: 'internal.process-signing-reminder',
        payload: { path: ['recipientId'], equals: seeded.recipient.id },
      },
    });
  expect(await children()).toHaveLength(1);
  await prisma.recipient.update({
    where: { id: seeded.recipient.id },
    data: { nextReminderAt: new Date(Date.now() - 2 * 86400000) },
  });
  const next = await createParent('internal.send-signing-reminders-sweep', {});
  expect((await signedDispatch(runtime.url, next)).status).toBe(200);
  await expect
    .poll(async () => (await prisma.recipient.findUniqueOrThrow({ where: { id: seeded.recipient.id } })).reminderCount)
    .toBe(2);
  const occurrences = await children();
  expect(occurrences).toHaveLength(2);
  expect(new Set(occurrences.map((job) => job.id)).size).toBe(2);
  expect(
    await prisma.emailDelivery.count({
      where: { jobId: { in: occurrences.map((job) => job.id) }, status: 'ACCEPTED' },
    }),
  ).toBe(2);
});

test('SMTP sink records intentional peer resets and rejects unexpected active resets', async () => {
  const sink = await startSmtpSink();
  try {
    const intentional = connect(sink.port, '127.0.0.1');
    await once(intentional, 'data');
    sink.expectPeerShutdown();
    intentional.resetAndDestroy();
    await expect.poll(() => sink.socketEvents().filter((event) => event.event === 'error').length).toBe(1);
    expect(sink.socketEvents().find((event) => event.event === 'error')).toMatchObject({
      code: 'ECONNRESET',
      expected: true,
    });
    expect(() => sink.assertNoUnexpectedErrors()).not.toThrow();

    // A later connection is outside the exact pre-shutdown snapshot.
    const unexpected = connect(sink.port, '127.0.0.1');
    await once(unexpected, 'data');
    unexpected.resetAndDestroy();
    await expect.poll(() => sink.socketEvents().filter((event) => event.event === 'error').length).toBe(2);
    expect(
      sink
        .socketEvents()
        .filter((event) => event.event === 'error')
        .at(-1),
    ).toMatchObject({ code: 'ECONNRESET', expected: false });
    expect(() => sink.assertNoUnexpectedErrors()).toThrow('Unexpected SMTP sink socket error');
  } finally {
    await sink.close();
  }
});
