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

const handleV1Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [document, recipient, fields, completedFields] = await Promise.all([
    getDocumentAndSenderByToken({
      token,
      userId: user?.id,
      requireAccessAuth: false,
    }).catch(() => null),
    getRecipientByToken({ token }).catch(() => null),
    getFieldsForToken({ token }),
    getCompletedFieldsForToken({ token }),
  ]);

  if (!document || !document.documentData || !recipient || document.status === DocumentStatus.DRAFT) {
    throw new Response('Not Found', { status: 404 });
  }

  const recipientWithFields = { ...recipient, fields };

  const isRecipientsTurn = await getIsRecipientsTurnToSign({ token });

  if (!isRecipientsTurn) {
    throw redirect(`/sign/${token}/waiting`);
  }

  const allRecipients =
    recipient.role === RecipientRole.ASSISTANT
      ? await getRecipientsForAssistant({
          token,
        })
      : [recipient];

  // Dictation eligibility must be decided here, over the FULL recipient list
  // — the same computation the completion route enforces. `allRecipients` is
  // role-scoped (assistants only see strictly later steps, not their own
  // group peers), so deriving it client-side from that list would offer
  // dictation the server then silently ignores.
  const nextPendingRecipient =
    document.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL
      ? await getNextPendingRecipient({
          documentId: document.id,
          currentRecipientId: recipient.id,
        })
      : null;

  // Only the identity is needed client-side (dictation flag + prefill).
  const nextRecipient = nextPendingRecipient
    ? { name: nextPendingRecipient.name, email: nextPendingRecipient.email }
    : null;

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: document.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isAccessAuthValid = derivedRecipientAccessAuth.every((accesssAuth) =>
    match(accesssAuth)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => true) // Allow without account requirement
      .exhaustive(),
  );

  let isDocumentAccessValid = isAccessAuthValid;

  const requiredAccessData = await getEnvelopeRequiredAccessData({
    envelopeId: document.id,
    recipientId: recipient.id,
  });

  if (requiredAccessData.isTwoFactorAuthRequired && !requiredAccessData.isTwoFactorAuthValid) {
    isDocumentAccessValid = false;
  }

  const recipientSignatures = await getRecipientSignatures({
    recipientId: recipient.id,
  });

  return {
    isDocumentAccessValid,
    document,
    recipient: recipientWithFields,
    allRecipients,
    nextRecipient,
    recipientSignatures,
    completedFields,
    requestMetadata,
    requiredAccessData,
  };
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const { user } = await getOptionalSession(request);

  const { envelope, recipient, envelopeForSigning } = await getEnvelopeForRecipientSigning({
    token,
    userId: user?.id,
  });

  await assertSenderNotDisabled(envelope.userId);

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  // CSC / TSP routing. TSP envelopes have three terminal recipient-page
  // states beyond the normal signing UI:
  //   1. `blocked` — service-scope OAuth returned a hard error (set by the
  //      callback as a one-shot `csc_blocking_error` cookie).
  //   2. `signing-in-progress` — credential-scope OAuth completed, SAD is
  //      attached server-side, page auto-fires the sync sign mutation.
  //   3. pre-auth — no service token yet, kick the recipient into
  //      service-scope OAuth.
  // The fourth state (service session valid, no SAD, no blocking error) falls
  // through to the normal signing UI.
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
    isDocumentAccessValid: true,
    envelopeForSigning,
    recipientAccessAuth: derivedRecipientAccessAuth,
  };
};

export const loader = async (loaderArgs: Route.LoaderArgs) => {
  const { params, request } = loaderArgs;

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const foundRecipient = await prisma.recipient.findUnique({
    where: {
      token,
    },
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

  if (isRecipientExpired(foundRecipient)) {
    throw new AppError(AppErrorCode.RECIPIENT_EXPIRED);
  }

  const branding = await loadRecipientBrandingByTeamId(foundRecipient.envelope.teamId);

  if (foundRecipient.envelope.internalVersion === 2) {
    const payloadV2 = await handleV2Loader(loaderArgs);

    // V2 payload may carry a one-shot `Set-Cookie` header (used to clear the
    // CSC blocking-error cookie after the loader reads it). Forward it via
    // the `superLoaderJson` response init so the browser actually applies the
    // header. The field stays on the payload — it's just a `Max-Age=0` clear
    // directive, not sensitive — and isn't read by any consumer.
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

  const teamSettings = await getTeamSettings(foundRecipient.envelope.teamId).catch(() => null);

  await viewedDocument({ token }).catch(() => null);

  return superLoaderJson({
    version: 1,
    payload: payloadV1,
    branding,
    teamSettings,
  } as const);
};

export default function SignDocumentPage() {
  const { version, payload, branding, teamSettings } = useSuperLoaderData<typeof loader>();

  const { user } = useOptionalSession();

  const nonce = useCspNonce();

  if (version === 1) {
    const { document, recipient, allRecipients, recipientSignatures, completedFields, requiredAccessData } =
      payload;

    const isDocumentAccessValid = payload.isDocumentAccessValid;

    const isAssisting = recipient.role === RecipientRole.ASSISTANT;

    const isSigned = recipient.signingStatus === SigningStatus.SIGNED;

    return (
      <div className="flex min-h-screen flex-col bg-background selection:bg-documenso-200">
        <AuthenticatedHeader user={user} branding={branding} />

        <main className="relative flex flex-1 flex-col pb-16">
          {!isDocumentAccessValid && (
            <DocumentSigningAuthPageView
              envelopeId={document.id}
              recipientId={recipient.id}
              recipientEmail={recipient.email}
              requiredAccessData={requiredAccessData}
            />
          )}

          {isDocumentAccessValid && (
            <div className="flex flex-1 flex-col">
              {isSigned && (
                <div className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col items-center justify-center px-4 pt-12 text-center">
                  <div className="relative mb-12">
                    <img
                      src={signingCelebration}
                      alt="Celebration"
                      className="h-48 w-48 object-contain"
                    />
                  </div>

                  <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                    <Trans>Document signed!</Trans>
                  </h1>

                  <p className="mx-auto mb-8 max-w-md text-lg text-muted-foreground">
                    <Trans>
                      You have successfully signed "{document.title}". A copy of the signed document
                      will be sent to all parties once completed.
                    </Trans>
                  </p>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Link
                      to="/"
                      className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Trans>Go to Dashboard</Trans>
                    </Link>
                  </div>
                </div>
              )}

              {!isSigned && (
                <DocumentSigningProvider
                  key={recipient.id}
                  document={document}
                  recipient={recipient}
                  allRecipients={allRecipients}
                  recipientSignatures={recipientSignatures}
                  completedFields={completedFields}
                  teamSettings={teamSettings}
                >
                  <DocumentSigningPageViewV1 isAssisting={isAssisting} />
                </DocumentSigningProvider>
              )}
            </div>
          )}
        </main>

        <RecipientBranding branding={branding} />
      </div>
    );
  }

  const { isDocumentAccessValid, envelopeForSigning, recipientAccessAuth } = payload;

  const isSigned = envelopeForSigning.recipient.signingStatus === SigningStatus.SIGNED;

  return (
    <div className="flex min-h-screen flex-col bg-background selection:bg-documenso-200">
      <AuthenticatedHeader user={user} branding={branding} />

      <main className="relative flex flex-1 flex-col">
        {!isDocumentAccessValid && (
          <DocumentSigningAuthProvider
            envelopeId={envelopeForSigning.id}
            recipientId={envelopeForSigning.recipient.id}
            recipientEmail={envelopeForSigning.recipient.email}
            recipientAccessAuth={recipientAccessAuth}
          >
            <DocumentSigningAuthPageView />
          </DocumentSigningAuthProvider>
        )}

        {isDocumentAccessValid && (
          <div className="flex flex-1 flex-col">
            {isSigned && (
              <div className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col items-center justify-center px-4 pt-12 text-center">
                <SigningCard3D className="mb-12 h-64 w-48" nonce={nonce} />

                <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                  <Trans>Document signed!</Trans>
                </h1>

                <p className="mx-auto mb-8 max-w-md text-lg text-muted-foreground">
                  <Trans>
                    You have successfully signed "{envelopeForSigning.title}". A copy of the signed
                    document will be sent to all parties once completed.
                  </Trans>
                </p>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    to="/"
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Trans>Go to Dashboard</Trans>
                  </Link>
                </div>
              </div>
            )}

            {!isSigned && (
              <EnvelopeRenderProvider
                envelopeId={envelopeForSigning.id}
                documentDataId={envelopeForSigning.documentDataId}
              >
                <EnvelopeSigningProvider
                  envelopeId={envelopeForSigning.id}
                  recipient={envelopeForSigning.recipient}
                >
                  {'csc' in payload && payload.csc.state === 'blocked' ? (
                    <CscRecipientBlockedPage code={payload.csc.code} />
                  ) : 'csc' in payload && payload.csc.state === 'signing-in-progress' ? (
                    <CscRecipientSigningInProgressPage sessionId={payload.csc.sessionId} />
                  ) : (
                    <DocumentSigningPageViewV2 />
                  )}
                </EnvelopeSigningProvider>
              </EnvelopeRenderProvider>
            )}
          </div>
        )}
      </main>

      <RecipientBranding branding={branding} />
    </div>
  );
}
