import { prisma } from '@documenso/prisma';
import { DocumentStatus, RecipientRole, SendStatus, SigningStatus } from '@prisma/client';

import { jobs } from '../../client';
import type { JobRunIO } from '../../client/_internal/job';
import type { TSendSigningRemindersSweepJobDefinition } from './send-signing-reminders-sweep';

export const run = async ({ io }: { payload: TSendSigningRemindersSweepJobDefinition; io: JobRunIO }) => {
  const now = new Date();

  const recipients = await prisma.recipient.findMany({
    where: {
      nextReminderAt: { lte: now },
      signingStatus: SigningStatus.NOT_SIGNED,
      sendStatus: SendStatus.SENT,
      role: { not: RecipientRole.CC },
      // Skip recipients whose signing deadline has passed. `expiresAt`
      // is the source of truth — the expiration sweep asynchronously
      // sets `expirationNotifiedAt`, so filtering on `expiresAt` also
      // covers the window before the expiration sweep runs.
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      envelope: {
        status: DocumentStatus.PENDING,
        deletedAt: null,
      },
    },
    select: { id: true, nextReminderAt: true },
    take: 1000,
  });

  if (recipients.length === 0) {
    io.logger.info('No recipients need signing reminders');
    return;
  }

  io.logger.info(`Found ${recipients.length} recipients needing signing reminders`);

  await Promise.all(
    recipients.map(async (recipient) => {
      await jobs.triggerJob({
        name: 'internal.process-signing-reminder',
        id: `reminder:${recipient.id}:${recipient.nextReminderAt?.toISOString()}`,
        payload: {
          recipientId: recipient.id,
          scheduledFor: recipient.nextReminderAt?.toISOString(),
        },
      });
    }),
  );
};
