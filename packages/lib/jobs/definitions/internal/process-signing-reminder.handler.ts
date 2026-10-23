import DocumentReminderEmailTemplate from '@documenso/email/templates/document-reminder';
import { prisma } from '@documenso/prisma';
import { msg } from '@lingui/core/macro';
import {
  DocumentDistributionMethod,
  DocumentStatus,
  OrganisationType,
  RecipientRole,
  SendStatus,
  SigningStatus,
  WebhookTriggerEvents,
} from '@prisma/client';
import { createElement } from 'react';

import { getI18nInstance } from '../../../client-only/providers/i18n-server';
import { NEXT_PUBLIC_WEBAPP_URL } from '../../../constants/app';
import { resolveNextReminderAt, ZEnvelopeReminderSettings } from '../../../constants/envelope-reminder';
import { RECIPIENT_ROLES_DESCRIPTION } from '../../../constants/recipient-roles';
import { buildEnvelopeEmailHeaders } from '../../../server-only/email/build-envelope-email-headers';
import { getEmailContext } from '../../../server-only/email/get-email-context';
import { assertOrganisationRatesAndLimits } from '../../../server-only/rate-limit/assert-organisation-rates-and-limits';
import { triggerWebhook } from '../../../server-only/webhooks/trigger/trigger-webhook';
import { DOCUMENT_AUDIT_LOG_TYPE, DOCUMENT_EMAIL_TYPE } from '../../../types/document-audit-logs';
import { extractDerivedDocumentEmailSettings } from '../../../types/document-email';
import { mapEnvelopeToWebhookDocumentPayload, ZWebhookDocumentSchema } from '../../../types/webhook-payload';
import { createDocumentAuditLogData } from '../../../utils/document-audit-logs';
import { renderCustomEmailTemplate } from '../../../utils/render-custom-email-template';
import { renderEmailWithI18N } from '../../../utils/render-email-with-i18n';
import { shouldShowNewAccountWarning } from '../../../utils/sender-trust';
import type { JobRunIO } from '../../client/_internal/job';
import type { TProcessSigningReminderJobDefinition } from './process-signing-reminder';

export const run = async ({ payload, io }: { payload: TProcessSigningReminderJobDefinition; io: JobRunIO }) => {
  const { recipientId, scheduledFor } = payload;
  const now = new Date();

  const recipient = await prisma.recipient.findFirst({
    where: { id: recipientId },
    include: {
      envelope: {
        include: {
          documentMeta: true,
          user: true,
          recipients: true,
          team: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  if (
    !recipient ||
    recipient.signingStatus !== SigningStatus.NOT_SIGNED ||
    recipient.sendStatus !== SendStatus.SENT ||
    recipient.role === RecipientRole.CC ||
    (recipient.expiresAt && recipient.expiresAt <= now) ||
    recipient.envelope.status !== DocumentStatus.PENDING ||
    recipient.envelope.deletedAt ||
    (scheduledFor && recipient.nextReminderAt?.toISOString() !== scheduledFor)
  ) {
    return;
  }

  const { envelope } = recipient;

  if (!envelope.documentMeta) {
    io.logger.warn(`Envelope ${envelope.id} missing documentMeta`);
    return;
  }

  // Skip if distribution method is NONE (manual link sharing, no emails).
  if (envelope.documentMeta.distributionMethod === DocumentDistributionMethod.NONE) {
    io.logger.info(`Envelope ${envelope.id} uses manual distribution, skipping email reminder`);
    return;
  }

  if (!extractDerivedDocumentEmailSettings(envelope.documentMeta).recipientSigningRequest) {
    io.logger.info(`Envelope ${envelope.id} has email signing requests disabled, skipping`);
    return;
  }

  const {
    branding,
    emailLanguage,
    organisationType,
    senderEmail,
    replyToEmail,
    organisationId,
    claims,
    emailsDisabled,
    emailTransport,
  } = await getEmailContext({
    emailType: 'RECIPIENT',
    source: {
      type: 'team',
      teamId: envelope.teamId,
    },
    meta: envelope.documentMeta,
  });

  // Don't send reminders if the owner is disabled (e.g. banned) or the organisation
  // has email sending disabled.
  if (envelope.user.disabled || emailsDisabled) {
    io.logger.info(`Envelope ${envelope.id} skipping reminder: owner disabled or organisation emails disabled`);
    return;
  }

  const i18n = await getI18nInstance(emailLanguage);

  const recipientActionVerb = i18n._(RECIPIENT_ROLES_DESCRIPTION[recipient.role].actionVerb).toLowerCase();

  let emailSubject = i18n._(msg`Reminder: Please ${recipientActionVerb} the document "${envelope.title}"`);

  if (organisationType === OrganisationType.ORGANISATION) {
    emailSubject = i18n._(msg`Reminder: ${envelope.team.name} invited you to ${recipientActionVerb} a document`);
  }

  const customEmailTemplate = {
    'signer.name': recipient.name,
    'signer.email': recipient.email,
    'document.name': envelope.title,
  };

  if (envelope.documentMeta.subject) {
    emailSubject = renderCustomEmailTemplate(
      i18n._(msg`Reminder: ${envelope.documentMeta.subject}`),
      customEmailTemplate,
    );
  }

  const emailMessage = envelope.documentMeta.message
    ? renderCustomEmailTemplate(envelope.documentMeta.message, customEmailTemplate)
    : undefined;

  const assetBaseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';
  const signDocumentLink = `${NEXT_PUBLIC_WEBAPP_URL()}/sign/${recipient.token}`;
  const reportUrl = `${NEXT_PUBLIC_WEBAPP_URL()}/report/${recipient.token}`;

  // Meter reminder emails against the organisation email quota/stats. Reminders
  // are unsolicited (the recipient didn't opt in to them) and can recur, so they
  // must be bounded by the same org limits as other outbound emails.
  const isRateLimited = await assertOrganisationRatesAndLimits({
    organisationId,
    organisationClaim: claims,
    type: 'email',
    count: 1,
  })
    .then(() => false)
    .catch((_err) => {
      io.logger.warn({
        msg: 'Signing reminder deferred: org email limit exceeded',
        organisationId,
        recipientId: recipient.id,
        envelopeId: envelope.id,
      });

      throw new Error('EMAIL_QUOTA_DEFERRED');
    });

  if (!isRateLimited) {
    io.logger.info(`Sending signing reminder for envelope ${envelope.id} to recipient ${recipient.id}`);

    const showNewAccountWarning =
      recipient.email !== envelope.user.email &&
      shouldShowNewAccountWarning({
        userCreatedAt: envelope.user.createdAt,
        organisationClaim: claims,
      });

    const template = createElement(DocumentReminderEmailTemplate, {
      recipientName: recipient.name,
      documentName: envelope.title,
      assetBaseUrl,
      signDocumentLink,
      customBody: emailMessage,
      role: recipient.role,
      reportUrl,
      newAccountWarningSenderEmail: showNewAccountWarning ? envelope.user.email : undefined,
    });

    const [html, text] = await Promise.all([
      renderEmailWithI18N(template, { lang: emailLanguage, branding }),
      renderEmailWithI18N(template, {
        lang: emailLanguage,
        branding,
        plainText: true,
      }),
    ]);

    await emailTransport.sendMail({
      to: {
        name: recipient.name,
        address: recipient.email,
      },
      from: senderEmail,
      replyTo: replyToEmail,
      subject: emailSubject,
      html,
      text,
      headers: buildEnvelopeEmailHeaders({
        userId: envelope.userId,
        envelopeId: envelope.id,
        teamId: envelope.teamId,
      }),
    });

    await prisma.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.EMAIL_SENT,
        envelopeId: envelope.id,
        data: {
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          recipientId: recipient.id,
          recipientRole: recipient.role,
          emailType: DOCUMENT_EMAIL_TYPE.REMINDER,
          isResending: false,
        },
      }),
    });

    await triggerWebhook({
      event: WebhookTriggerEvents.DOCUMENT_REMINDER_SENT,
      data: ZWebhookDocumentSchema.parse(mapEnvelopeToWebhookDocumentPayload(envelope)),
      userId: envelope.userId,
      teamId: envelope.teamId,
    });
  }

  // Advance the occurrence only after provider acceptance. A crash before this
  // point retries the same durable job and the mail ledger suppresses resubmission.
  await io.runTask('advance-reminder-occurrence', async () => {
    const nextReminderAt = recipient.sentAt
      ? resolveNextReminderAt({
          config: envelope.documentMeta?.reminderSettings
            ? ZEnvelopeReminderSettings.parse(envelope.documentMeta.reminderSettings)
            : null,
          sentAt: recipient.sentAt,
          lastReminderSentAt: now,
          reminderCount: recipient.reminderCount + 1,
        })
      : null;
    await prisma.recipient.updateMany({
      where: { id: recipient.id, nextReminderAt: recipient.nextReminderAt },
      data: { lastReminderSentAt: now, nextReminderAt, reminderCount: { increment: 1 } },
    });
  });
};
