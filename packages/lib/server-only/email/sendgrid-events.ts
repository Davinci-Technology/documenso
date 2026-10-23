import { createPublicKey, verify } from 'node:crypto';

import { prisma } from '@documenso/prisma';
import { z } from 'zod';

const eventSchema = z.object({
  sg_event_id: z.string().min(1).max(250),
  sg_message_id: z.string().max(250).optional(),
  davinci_delivery_id: z.string().min(1).max(100),
  event: z.enum([
    'processed',
    'delivered',
    'deferred',
    'bounce',
    'dropped',
    'spamreport',
    'unsubscribe',
    'open',
    'click',
  ]),
  timestamp: z.number().int().nonnegative(),
});

export const verifySendGridSignature = (
  body: Buffer,
  signature: string,
  timestamp: string,
  publicKey: string,
  now = Date.now(),
) => {
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) {
    return false;
  }
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), type: 'spki', format: 'der' });
    return verify('sha256', Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
};

// Store each event exactly once. Provider event arrival order must never replace
// a terminal outcome with an earlier processed/deferred event. Opens/clicks are
// deliberately not interpreted as proof of inbox placement or human interaction.
export const ingestSendGridEvents = async (input: unknown) => {
  const events = z.array(z.unknown()).max(1000).parse(input);
  for (const inputEvent of events) {
    const parsed = eventSchema.safeParse(inputEvent);
    if (!parsed.success) {
      continue;
    }
    const event = parsed.data;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${event.davinci_delivery_id} FOR UPDATE`;
      const delivery = await tx.emailDelivery.findUnique({ where: { id: event.davinci_delivery_id } });
      if (!delivery) {
        return;
      }
      const inserted = await tx.emailDeliveryEvent.createMany({
        data: {
          id: event.sg_event_id,
          deliveryId: delivery.id,
          event: event.event,
          occurredAt: new Date(event.timestamp * 1000),
        },
        skipDuplicates: true,
      });
      if (!inserted.count) {
        return;
      }
      // Negative terminal outcomes dominate; delivery dominates deferred/processed.
      const negative = ['bounce', 'dropped', 'spamreport', 'unsubscribe'];
      const canUpdate =
        negative.includes(event.event) ||
        (!negative.includes(delivery.status) && event.event === 'delivered') ||
        (!negative.includes(delivery.status) &&
          delivery.status !== 'delivered' &&
          ['processed', 'deferred'].includes(event.event));
      if (canUpdate) {
        await tx.emailDelivery.update({
          where: { id: delivery.id },
          data: { status: event.event, providerMessageId: event.sg_message_id },
        });
      }
      if (['deferred', ...negative].includes(event.event)) {
        console.error('[DELIVERY_ALERT]', { deliveryId: delivery.id, status: event.event });
      }
    });
  }
};
