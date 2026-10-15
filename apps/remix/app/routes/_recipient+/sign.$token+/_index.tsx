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

  let isSenderDisabled = false;

  try {
    await assertSenderNotDisabled({ userId: document.userId });
  } catch {
    isSenderDisabled = true;
  }

  if (isSenderDisabled) {
    return { isSenderDisabled: true } as const;
  }

  if (!isAccessAuthValid) {
    // If we need to verify the recipient's access, get the available auth methods for the recipient.
    const envelopeAccessData = await getEnvelopeRequiredAccessData({ token }).catch(() => null);

    // If there is a problem with the envelope, then we can't get the access data.
    if (!envelopeAccessData) {
      throw new Response('Not Found', { status: 404 });
    }

    return {
      isDocumentAccessValid: false,
      derivedRecipientAccessAuth,
      envelopeAccessData,
    } as const;
  }

  await viewedDocument({ token, userId: user?.id, requestMetadata });

  const signatures = await getRecipientSignatures({ token });

  return {
    isDocumentAccessValid: true,
    isSenderDisabled: false,
    document,
    recipient: recipientWithFields,
    allRecipients,
    nextRecipient,
    signatures,
    completedFields,
    isRecipientsTurn,
  } as const;
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [recipient, envelope] = await Promise.all([
    getRecipientByToken({ token }).catch(() => null),
    getEnvelopeForRecipientSigning({
      token,
      userId: user?.id,
      requestMetadata,
    }),
  ]);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isAccessAuthValid = derivedRecipientAccessAuth.every((accesssAuth) =>
    match(accesssAuth)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => true) // Allow without account requirement
      .exhaustive(),
  );

  let isSenderDisabled = false;

  try {
    await assertSenderNotDisabled({ userId: envelope.userId });
  } catch {
    isSenderDisabled = true;
  }

  if (isSenderDisabled) {
    return { isSenderDisabled: true } as const;
  }

  if (!isAccessAuthValid) {
    // If we need to verify the recipient's access, get the available auth methods for the recipient.
    const envelopeAccessData = await getEnvelopeRequiredAccessData({ token }).catch(() => null);

    // If there is a problem with the envelope, then we can't get the access data.
    if (!envelopeAccessData) {
      throw new Response('Not Found', { status: 404 });
    }

    return {
      isDocumentAccessValid: false,
      derivedRecipientAccessAuth,
      envelopeAccessData,
    } as const;
  }

  const envelopeForSigning = await getEnvelopeForRecipientSigning({
    token,
    userId: user?.id,
    requestMetadata,
    recipientAccessAuth: derivedRecipientAccessAuth,
  }).catch(() => null);

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
  } as const;
};

export const loader = async (loaderArgs: Route.LoaderArgs): Promise<Response> => {
  const { params, request } = loaderArgs;

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const foundRecipient = await getRecipientByToken({ token }).catch(() => null);

  if (!foundRecipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const isExpiredRecipient = isRecipientExpired(foundRecipient.expiresAt);

  if (isExpiredRecipient) {
    throw redirect(`/sign/${token}/expired`);
  }

  const branding = await loadRecipientBrandingByTeamId({ teamId: foundRecipient.teamId });

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

  return superLoaderJson({
    isSenderDisabled: payloadV1.isSenderDisabled,
    version: 1,
    payload: payloadV1,
    branding,
  } as const);
};

export default function SigningPage() {
  const { payload, version, branding } = useSuperLoaderData<typeof loader>();

  const nonce = useCspNonce();

  // Handle sender disabled state early.
  if (payload.isSenderDisabled) {
    return (
      <div className="min-h-screen flex flex-col">
        <AuthenticatedHeader />
        <DocumentSigningSenderDisabledPage />
      </div>
    );
  }

  // Handle access auth.
  if (!payload.isDocumentAccessValid) {
    return (
      <div className="min-h-screen flex flex-col">
        <AuthenticatedHeader />
        <DocumentSigningAuthProvider
          derivedRecipientAccessAuth={payload.derivedRecipientAccessAuth}
          envelopeAccessData={payload.envelopeAccessData}
        >
          <DocumentSigningAuthPageView />
        </DocumentSigningAuthProvider>
      </div>
    );
  }

  if (version === 1) {
    const user = useOptionalSession();

    return (
      <div className="min-h-screen flex flex-col">
        <AuthenticatedHeader />

        <DocumentSigningProvider
          document={payload.document}
          recipient={payload.recipient}
          allRecipients={payload.allRecipients}
          signatures={payload.signatures}
          completedFields={payload.completedFields}
          nextRecipient={payload.nextRecipient}
          isCurrentlyViewing={true}
          isRecipientTurn={payload.isRecipientsTurn}
          user={user}
        >
          {({ isDocumentPdfLoaded, redirectToNextStep, errorMessage }) => (
            <div className="mx-auto w-full max-w-screen-xl px-4">
              <div className="flex min-h-[calc(100vh-6rem)] flex-col justify-center py-12 lg:py-24">
                <div className="grid grid-cols-12 gap-8">
                  <div className="col-span-12 md:col-span-5 lg:col-span-4">
                    <SigningCard3D>
                      <img src={signingCelebration} alt="Signing celebration" className="h-32 w-auto" />

                      <div className="flex h-full flex-col items-center justify-center text-center">
                        <h2 className="text-2xl font-semibold text-slate-500">
                          <Trans>You're invited to sign a document!</Trans>
                        </h2>

                        <p className="text-muted-foreground mt-4 text-sm">
                          <Trans>Click on the document on the right side to get started.</Trans>
                        </p>

                        {!isDocumentPdfLoaded && (
                          <div className="text-muted-foreground mt-6 flex items-center justify-center gap-2 text-sm">
                            <Clock8 className="h-4 w-4 animate-spin" />
                            <span>
                              <Trans>Loading document...</Trans>
                            </span>
                          </div>
                        )}

                        {errorMessage && (
                          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
                            {errorMessage}
                          </div>
                        )}
                      </div>
                    </SigningCard3D>
                  </div>

                  <div className="col-span-12 md:col-span-7 lg:col-span-8">
                    <DocumentSigningPageViewV1 onComplete={redirectToNextStep} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </DocumentSigningProvider>

        {branding.primaryColor && (
          <RecipientBranding
            primaryColor={branding.primaryColor}
            secondaryColor={branding.secondaryColor}
            nonce={nonce}
          />
        )}
      </div>
    );
  }

  // Handle CSC terminal states.
  if (version === 2 && 'csc' in payload && payload.csc) {
    if (payload.csc.state === 'blocked') {
      return (
        <div className="min-h-screen flex flex-col">
          <AuthenticatedHeader />
          <CscRecipientBlockedPage code={payload.csc.code} />
          {branding.primaryColor && (
            <RecipientBranding
              primaryColor={branding.primaryColor}
              secondaryColor={branding.secondaryColor}
              nonce={nonce}
            />
          )}
        </div>
      );
    }

    if (payload.csc.state === 'signing-in-progress') {
      return (
        <div className="min-h-screen flex flex-col">
          <AuthenticatedHeader />
          <CscRecipientSigningInProgressPage sessionId={payload.csc.sessionId} />
          {branding.primaryColor && (
            <RecipientBranding
              primaryColor={branding.primaryColor}
              secondaryColor={branding.secondaryColor}
              nonce={nonce}
            />
          )}
        </div>
      );
    }
  }

  // Normal V2 flow.
  if (version === 2 && payload.envelopeForSigning) {
    const envelope = payload.envelopeForSigning;

    return (
      <div className="min-h-screen flex flex-col">
        <AuthenticatedHeader />

        <EnvelopeRenderProvider>
          <EnvelopeSigningProvider envelope={envelope}>
            <DocumentSigningPageViewV2 />
          </EnvelopeSigningProvider>
        </EnvelopeRenderProvider>

        {branding.primaryColor && (
          <RecipientBranding
            primaryColor={branding.primaryColor}
            secondaryColor={branding.secondaryColor}
            nonce={nonce}
          />
        )}
      </div>
    );
  }

  // Fallback (should not happen in normal flows).
  throw new Response('Not Found', { status: 404 });
}