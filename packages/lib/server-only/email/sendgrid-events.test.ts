import { generateKeyPairSync, sign } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  emailDelivery: { findUnique: vi.fn(), update: vi.fn() },
  emailDeliveryEvent: { createMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));
vi.mock('@documenso/prisma', () => ({ prisma: db }));

import { ingestSendGridEvents, verifySendGridSignature } from './sendgrid-events';

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn) => fn(db));
  db.emailDelivery.findUnique.mockResolvedValue({ id: 'message1', status: 'ACCEPTED' });
  db.emailDeliveryEvent.createMany.mockResolvedValue({ count: 1 });
});

describe('SendGrid events', () => {
  it('accepts signed raw bytes; rejects missing/tampered/stale signatures', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const body = Buffer.from('[{"event":"delivered"}]');
    const timestamp = '1792771200';
    const signature = sign('sha256', Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString('base64');
    const now = Number(timestamp) * 1000;
    expect(verifySendGridSignature(body, signature, timestamp, key, now)).toBe(true);
    expect(verifySendGridSignature(Buffer.from('[]'), signature, timestamp, key, now)).toBe(false);
    expect(verifySendGridSignature(body, '', timestamp, key, now)).toBe(false);
    expect(verifySendGridSignature(body, signature, timestamp, key, now + 301000)).toBe(false);
  });
  it('deduplicates event IDs and records only minimal correlated metadata', async () => {
    const event = {
      sg_event_id: 'event1',
      davinci_delivery_id: 'message1',
      event: 'delivered',
      timestamp: 1792771200,
      email: 'do-not-persist@example.com',
    };
    await ingestSendGridEvents([event]);
    expect(db.emailDeliveryEvent.createMany.mock.calls[0][0]).toEqual({
      data: {
        id: 'event1',
        deliveryId: 'message1',
        event: 'delivered',
        occurredAt: new Date(1792771200000),
      },
      skipDuplicates: true,
    });
    db.emailDeliveryEvent.createMany.mockResolvedValue({ count: 0 });
    db.emailDelivery.update.mockClear();
    await ingestSendGridEvents([event]);
    expect(db.emailDelivery.update).not.toHaveBeenCalled();
  });
  it('does not regress delivered outcomes on delayed processed events or unknown IDs', async () => {
    db.emailDelivery.findUnique.mockResolvedValue({ id: 'message1', status: 'delivered' });
    await ingestSendGridEvents([
      { sg_event_id: 'event2', davinci_delivery_id: 'message1', event: 'processed', timestamp: 1792771200 },
    ]);
    expect(db.emailDelivery.update).not.toHaveBeenCalled();
    db.emailDelivery.findUnique.mockResolvedValue(null);
    await ingestSendGridEvents([
      { sg_event_id: 'event3', davinci_delivery_id: 'unknown', event: 'bounce', timestamp: 1792771200 },
    ]);
    expect(db.emailDeliveryEvent.createMany).toHaveBeenCalledTimes(1);
  });
});
