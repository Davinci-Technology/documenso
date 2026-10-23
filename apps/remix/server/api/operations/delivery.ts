import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { ingestSendGridEvents, verifySendGridSignature } from '@documenso/lib/server-only/email/sendgrid-events';
import { isAdmin } from '@documenso/lib/utils/is-admin';
import { prisma } from '@documenso/prisma';
import { Hono } from 'hono';

export const deliveryOperationsRoute = new Hono();

deliveryOperationsRoute.post('/webhooks/sendgrid', async (c) => {
  const publicKey = process.env.NEXT_PRIVATE_SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!publicKey) {
    return c.text('Provider event verification is not configured', 503);
  }
  // SendGrid limits batches to 1MB. Bound both declared and actual size.
  if (Number(c.req.header('content-length') ?? 0) > 1_048_576) {
    return c.text('Request too large', 413);
  }
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (!reader) {
    return c.text('Bad request', 400);
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.length;
    if (length > 1_048_576) {
      await reader.cancel();
      return c.text('Request too large', 413);
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  if (
    !verifySendGridSignature(
      body,
      c.req.header('x-twilio-email-event-webhook-signature') ?? '',
      c.req.header('x-twilio-email-event-webhook-timestamp') ?? '',
      publicKey,
    )
  ) {
    return c.text('Unauthorized', 403);
  }
  let events: unknown;
  try {
    events = JSON.parse(body.toString('utf8'));
    if (!Array.isArray(events) || events.length > 1000) {
      return c.text('Bad request', 400);
    }
  } catch {
    return c.text('Bad request', 400);
  }
  await ingestSendGridEvents(events);
  return c.text('OK');
});

deliveryOperationsRoute.get('/operations/delivery', async (c) => {
  const { user, session } = await getOptionalSession(c);
  if (!user || !session || !isAdmin(user) || session.isEmbed) {
    return c.text('Forbidden', 403);
  }
  const [jobs, mail, recentFailures, recentMailIssues] = await Promise.all([
    prisma.backgroundJob.groupBy({ by: ['status'], _count: true }),
    prisma.emailDelivery.groupBy({ by: ['status'], _count: true }),
    prisma.backgroundJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: { id: true, jobId: true, status: true, retried: true, lastError: true, updatedAt: true },
    }),
    prisma.emailDelivery.findMany({
      where: { status: { notIn: ['ACCEPTED', 'processed', 'delivered'] } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: {
        id: true,
        jobId: true,
        envelopeId: true,
        messageId: true,
        providerMessageId: true,
        status: true,
        errorCode: true,
        updatedAt: true,
      },
    }),
  ]);
  return c.json({
    jobs,
    mail,
    recentFailures,
    recentMailIssues,
    guidance:
      'Inspect failed jobs and deferred/bounced mail. SUBMITTING/AMBIGUOUS require provider reconciliation before any resend. Delivered means recipient server acceptance, not inbox placement.',
  });
});
