import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@documenso/prisma';
import type { Transporter } from 'nodemailer';

import { emailDeliveryContext } from './delivery-context';

// Retrying a definite SMTP rejection is safe. A disconnected DATA submission is
// ambiguous: fail visibly and reconcile with provider events before resubmitting.
export const classifyMailFailure = (error: unknown): 'RETRYABLE' | 'FAILED' | 'AMBIGUOUS' => {
  const value = error as { responseCode?: number; code?: string; command?: string };
  if (value.responseCode && value.responseCode >= 400 && value.responseCode < 500) {
    return 'RETRYABLE';
  }
  if (value.responseCode && value.responseCode >= 500) {
    return 'FAILED';
  }
  if (['EDNS', 'ECONNECTION'].includes(value.code ?? '') || value.command === 'CONN') {
    return 'RETRYABLE';
  }
  return 'AMBIGUOUS';
};

export const withDeliveryTracking = (transporter: Transporter): Transporter => {
  const tracked = Object.create(transporter) as Transporter;
  tracked.sendMail = (async (options: Parameters<Transporter['sendMail']>[0]) => {
    const context = emailDeliveryContext.getStore();
    const id = context
      ? createHash('sha256')
          .update(
            JSON.stringify([
              context.jobId,
              context.taskId ?? 'handler',
              options.to,
              options.cc,
              options.bcc,
              options.subject,
            ]),
          )
          .digest('hex')
      : randomUUID();
    const messageId = `<${id}@delivery.davincisolutions.ai>`;
    const previous = await prisma.emailDelivery.findUnique({ where: { id } });
    if (previous && ['ACCEPTED', 'processed', 'delivered', 'open', 'click'].includes(previous.status)) {
      return { messageId, accepted: [], rejected: [] };
    }
    if (previous && previous.status !== 'RETRYABLE') {
      throw new Error('EMAIL_DELIVERY_REQUIRES_RECONCILIATION');
    }
    const headers = options.headers as Record<string, string> | undefined;
    // Deterministic intent is independent of parallel recipient ordering. Claim
    // with create/CAS: a second worker cannot submit the same intent concurrently.
    if (previous) {
      const claimed = await prisma.emailDelivery.updateMany({
        where: { id, status: 'RETRYABLE' },
        data: { status: 'SUBMITTING', errorCode: null },
      });
      if (!claimed.count) {
        throw new Error('EMAIL_DELIVERY_REQUIRES_RECONCILIATION');
      }
    } else {
      await prisma.emailDelivery.create({
        data: {
          id,
          messageId,
          jobId: context?.jobId,
          taskId: context?.taskId,
          envelopeId: headers?.['X-Documenso-Envelope-Id'],
        },
      });
    }
    try {
      const info = await transporter.sendMail({
        ...options,
        messageId,
        headers: {
          ...headers,
          'X-SMTPAPI': JSON.stringify({ unique_args: { davinci_delivery_id: id } }),
        },
      });
      // Partial recipient rejection is visible and must not cause accepted
      // recipients to receive automatic duplicates.
      const status = info.rejected?.length ? 'AMBIGUOUS' : 'ACCEPTED';
      await prisma.emailDelivery.updateMany({
        where: { id, status: 'SUBMITTING' },
        data: { status, providerMessageId: String(info.messageId ?? messageId).slice(0, 250) },
      });
      if (status === 'AMBIGUOUS') {
        throw new Error('EMAIL_PARTIAL_REJECTION');
      }
      return info;
    } catch (error) {
      const status = (error as Error).message === 'EMAIL_PARTIAL_REJECTION' ? 'AMBIGUOUS' : classifyMailFailure(error);
      await prisma.emailDelivery.updateMany({
        where: { id, status: 'SUBMITTING' },
        data: {
          status,
          errorCode: String((error as { responseCode?: number }).responseCode ?? status),
        },
      });
      console.error('[DELIVERY_ALERT]', { deliveryId: id, jobId: context?.jobId, status });
      // Deliberately do not include raw SMTP errors, addresses or payloads.
      throw new Error(`EMAIL_DELIVERY_${status}`);
    }
  }) as Transporter['sendMail'];
  return tracked;
};
