import type { Transporter } from 'nodemailer';
import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ emailDelivery: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() } }));
vi.mock('@documenso/prisma', () => ({ prisma: db }));

import { emailDeliveryContext } from '@documenso/email/delivery-context';
import { classifyMailFailure, withDeliveryTracking } from '@documenso/email/tracked-transport';

beforeEach(() => {
  vi.clearAllMocks();
  db.emailDelivery.findUnique.mockResolvedValue(null);
});

it('records acceptance and stable correlation without retaining content', async () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'provider1', rejected: [] });
  const transport = withDeliveryTracking({ sendMail } as unknown as Transporter);
  await emailDeliveryContext.run({ jobId: 'job1', taskId: 'task1', sequence: 0 }, () =>
    transport.sendMail({ to: 'sink@example.com', html: 'secret content' }),
  );
  expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: 'ACCEPTED', providerMessageId: 'provider1' } }),
  );
  expect(JSON.stringify(db.emailDelivery.create.mock.calls)).not.toContain('secret content');
  const firstId = db.emailDelivery.create.mock.calls[0][0].data.id;
  db.emailDelivery.findUnique.mockResolvedValue({ id: firstId, status: 'ACCEPTED' });
  await emailDeliveryContext.run({ jobId: 'job1', taskId: 'task1', sequence: 0 }, () =>
    transport.sendMail({ to: 'sink@example.com' }),
  );
  expect(sendMail).toHaveBeenCalledTimes(1);
});

it('refuses ambiguous or crash-stranded SMTP intent on job recovery', async () => {
  const sendMail = vi.fn();
  const transport = withDeliveryTracking({ sendMail } as unknown as Transporter);
  for (const status of ['SUBMITTING', 'AMBIGUOUS', 'FAILED']) {
    db.emailDelivery.findUnique.mockResolvedValue({ status });
    await expect(
      emailDeliveryContext.run({ jobId: 'job1', sequence: 0 }, () => transport.sendMail({ to: 'sink@example.com' })),
    ).rejects.toThrow('RECONCILIATION');
  }
  expect(sendMail).not.toHaveBeenCalled();
});

it('distinguishes definite transient rejection from ambiguous DATA timeout', () => {
  expect(classifyMailFailure({ responseCode: 451 })).toBe('RETRYABLE');
  expect(classifyMailFailure({ responseCode: 550 })).toBe('FAILED');
  expect(classifyMailFailure({ code: 'ETIMEDOUT', command: 'DATA' })).toBe('AMBIGUOUS');
  expect(classifyMailFailure({ code: 'ECONNECTION' })).toBe('RETRYABLE');
});

it('keeps per-recipient intents stable across parallel order and distinct reminder jobs', async () => {
  const sendMail = vi.fn().mockResolvedValue({ rejected: [] });
  const transport = withDeliveryTracking({ sendMail } as unknown as Transporter);
  const run = async (jobId: string, recipients: string[]) =>
    emailDeliveryContext.run({ jobId, sequence: 0 }, async () => {
      for (const to of recipients) {
        await transport.sendMail({ to, subject: 'Reminder' });
      }
    });
  await run('reminder-occurrence1', ['a@example.com', 'b@example.com']);
  const initial = db.emailDelivery.create.mock.calls.map(([call]) => call.data.id);
  db.emailDelivery.create.mockClear();
  await run('reminder-occurrence1', ['b@example.com', 'a@example.com']);
  expect(db.emailDelivery.create.mock.calls.map(([call]) => call.data.id)).toEqual(initial.toReversed());
  db.emailDelivery.create.mockClear();
  await run('reminder-occurrence2', ['a@example.com']);
  expect(db.emailDelivery.create.mock.calls[0][0].data.id).not.toBe(initial[0]);
});

it('records an ambiguous DATA failure and retries a definite 451 rejection via compare-and-set only', async () => {
  const sendMail = vi.fn().mockRejectedValue({ code: 'ETIMEDOUT', command: 'DATA' });
  const transport = withDeliveryTracking({ sendMail } as unknown as Transporter);
  await expect(transport.sendMail({ to: 'sink@example.com' })).rejects.toThrow('EMAIL_DELIVERY_AMBIGUOUS');
  expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: 'AMBIGUOUS', errorCode: 'AMBIGUOUS' } }),
  );
  db.emailDelivery.findUnique.mockResolvedValue({ status: 'RETRYABLE' });
  db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
  sendMail.mockResolvedValue({ messageId: 'retry-accepted', rejected: [] });
  await transport.sendMail({ to: 'sink@example.com' });
  expect(sendMail).toHaveBeenCalledTimes(2);
  expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ status: 'RETRYABLE' }),
      data: { status: 'SUBMITTING', errorCode: null },
    }),
  );
});
