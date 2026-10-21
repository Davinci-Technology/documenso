import signingCelebration from '@documenso/assets/images/signing-celebration.png';
import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import {
  expiredCscBlockingErrorCookieHeader,
  readCscBlockingErrorFromRequest,
} from '@documenso/ee/server-only/signing/csc/cookies/blocking-error-cookie';
import { readCscSadSessionFromRequest } from '@documenso/ee/server-only/signing/csc/cookies/sad-session-cookie';
import { readCscServiceSessionFromRequest } from '@documenso/ee/server-only/signing/csc/cookies/service-session-cookie';
import { EnvelopeRenderProvider } from '@documenso/lib/client-only/providers/envelope-render-provider';
import { useOptionalSession } from '@documenso/lib/client-only/providers/session';
import { IS_INSTANCE_CSC_MODE } from '@documenso/lib/constants/app';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { loadRecipientBrandingByTeamId } from '@documenso/lib/server-only/branding/load-recipient-branding';
import { getDocumentAndSenderByToken } from '@documenso/lib/server-only/document/get-document-by-token';
import { viewedDocument } from '@documenso/lib/server-only/document/viewed-document';
import { getEnvelopeForRecipientSigning } from '@documenso/lib/server-only/envelope/get-envelope-for-recipient-signing';
import { getEnvelopeRequiredAccessData } from '@documenso/lib/server-only/envelope/get-envelope-required-access-data';
import { getCompletedFieldsForToken } from '@documenso/lib/server-only/field/get-completed-fields-for-token';
import { getFieldsForToken } from '@documenso/lib/server-only/field/get-fields-for-token';
import { getIsRecipientsTurnToSign } from '@documenso/lib/server-only/recipient/get-is-recipient-turn';
import { getNextPendingRecipient } from '@documenso/lib/server-only/recipient/get-next-pending-recipient';
import { getRecipientByToken } from '@documenso/lib/server-only/recipient/get-recipient-by-token';
import { getRecipientSignatures } from '@documenso/lib/server-only/recipient/get-recipient-signatures';
import { getRecipientsForAssistant } from '@documenso/lib/server-only/recipient/get-recipients-for-assistant';
import { getTeamSettings } from '@documenso/lib/server-only/team/get-team-settings';
import { assertSenderNotDisabled } from '@documenso/lib/server-only/user/assert-user-not-disabled';
import { getUserByEmail } from '@documenso/lib/server-only/user/get-user-by-email';
import { DocumentAccessAuth } from '@documenso/lib/types/document-auth';
import { isTspEnvelope } from '@documenso/lib/types/signature-level';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
import { isRecipientExpired } from '@documenso/lib/utils/recipients';
import { prisma } from '@documenso/prisma';
import { SigningCard3D } from '@documenso/ui/components/signing-card';
import { Trans } from '@lingui/react/macro';
import { DocumentSigningOrder, DocumentStatus, RecipientRole, SigningStatus } from '@prisma/client';
import { Clock8 } from 'lucide-react';
import { Link, redirect } from 'react-router';
import { getOptionalLoaderContext } from 'server/utils/get-loader-session';
import { match } from 'ts-pattern';

import { Header as AuthenticatedHeader } from '~/components/general/app-header';
import { CscRecipientBlockedPage } from '~/components/general/document-signing/csc-recipient-blocked-page';
import { CscRecipientSigningInProgressPage } from '~/components/general/document-signing/csc-recipient-signing-in-progress-page';
import { DocumentSigningAuthPageView } from '~/components/general/document-signing/document-signing-auth-page';
import { DocumentSigningAuthProvider } from '~/components/general/document-signing/document-signing-auth-provider';
import { DocumentSigningPageViewV1 } from '~/components/general/document-signing/document-signing-page-view-v1';
import { DocumentSigningPageViewV2 } from '~/components/general/document-signing/document-signing-page-view-v2';
import { DocumentSigningProvider } from '~/components/general/document-signing/document-signing-provider';
import { DocumentSigningSenderDisabledPage } from '~/components/general/document-signing/document-signing-sender-disabled-page';
import { EnvelopeSigningProvider } from '~/components/general/document-signing/envelope-signing-provider';
import { RecipientBranding } from '~/components/general/recipient-branding';
import { useCspNonce } from '~/utils/nonce';
import { superLoaderJson, useSuperLoaderData } from '~/utils/super-json-loader';

import type { Route } from './+types/_index';

// ... (rest of loader logic merging handled carefully)
const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const { user } = await getOptionalSession(request);

  const recipient = await getRecipientByToken({ token });

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const envelope = await getEnvelopeForRecipientSigning({
    token,
    userId: user?.id,
  });

  if (!envelope) {
    throw new Response('Not Found', { status: 404 });
  }

  await assertSenderNotDisabled(envelope.userId);

  const isRecipientsTurn = await getIsRecipientsTurnToSign({ token });

  if (!isRecipientsTurn) {
    throw redirect(`/sign/${token}/waiting`);
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isAccessAuthValid = derivedRecipientAccessAuth.every((accessAuth) =>
    match(accessAuth)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => true)
      .exhaustive(),
  );

  const envelopeForSigning = {
    ...envelope,
    recipientAccessAuth: derivedRecipientAccessAuth,
  };

  if (IS_INSTANCE_CSC_MODE() && isTspEnvelope(envelope)) {
    const blockingError = await readCscBlockingErrorFromRequest(request);

    if (blockingError && blockingError.recipientToken === token) {
      return {
        isDocumentAccessValid: true,
        envelopeForSigning,
        csc: { state: 'blocked', code: blockingError.code } as const,
        responseHeaders: { 'Set-Cookie': expiredCscBlockingErrorCookieHeader() },
      } as const;
    }

    const sadSessionId = await readCscSadSessionFromRequest(request);

    if (sadSessionId) {
      const cscSession = await prisma.cscSession.findUnique({
        where: { id: sadSessionId },
      });

      const isSadSessionValid =
        cscSession !== null &&
        cscSession.recipientId === recipient.id &&
        cscSession.encryptedSad !== null &&
        cscSession.sadExpiresAt !== null &&
        cscSession.sadExpiresAt > new Date();

      if (isSadSessionValid) {
        return {
          isDocumentAccessValid: true,
          envelopeForSigning,
          csc: { state: 'signing-in-progress', sessionId: sadSessionId } as const,
        } as const;
      }
    }

    const serviceSessionToken = await readCscServiceSessionFromRequest(request);

    if (serviceSessionToken !== token) {
      throw redirect(`/api/csc/oauth/authorize?scope=service&token=${encodeURIComponent(token)}`);
    }
  }

  return {
    isDocumentAccessValid: isAccessAuthValid,
    envelopeForSigning,
  } as const;
};

export const loader = async (loaderArgs: Route.LoaderArgs) => {
  const { params, request } = loaderArgs;
  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const foundRecipient = await prisma.recipient.findUnique({
    where: { token },
    include: {
      envelope: {
        select: {
          id: true,
          teamId: true,
          internalVersion: true,
        },
      },
    },
  });

  if (!foundRecipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const branding = await loadRecipientBrandingByTeamId(foundRecipient.envelope.teamId);

  if (foundRecipient.envelope.internalVersion === 2) {
    const payloadV2 = await handleV2Loader(loaderArgs);

    const responseHeaders =
      'responseHeaders' in payloadV2 && payloadV2.responseHeaders ? payloadV2.responseHeaders : undefined;

    return superLoaderJson(
      {
        isSenderDisabled: false,
        version: 2,
        payload: payloadV2,
        branding,
      } as const,
      responseHeaders ? { headers: responseHeaders } : undefined,
    );
  }

  const payloadV1 = await handleV1Loader(loaderArgs);

  return superLoaderJson({
    version: 1,
    payload: payloadV1,
    branding,
  } as const);
};
