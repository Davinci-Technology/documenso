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

  let derivedRecipientActionAuth = derivedRecipientAccessAuth;

  if (!isAccessAuthValid) {
    derivedRecipientActionAuth = [DocumentAccessAuth.ACCOUNT];
  }

  // Signature helper is only helpful for recipients with signatures.
  const signatures = await getRecipientSignatures({
    recipientId: recipientWithFields.id,
  });

  return {
    document,
    recipient: recipientWithFields,
    allRecipients,
    nextRecipient,
    derivedRecipientActionAuth,
    signatures: signatures.length > 0 ? signatures : null,
    completedFields,
    user,
  };
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [recipient] = await Promise.all([getRecipientByToken({ token }).catch(() => null)]);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: recipient.envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const envelopeForSigning = await getEnvelopeForRecipientSigning({
    token,
    userId: user?.id,
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
  };
};

export const loader = async (loaderArgs: Route.LoaderArgs): Promise<Response> => {
  const { params } = loaderArgs;
  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const foundRecipient = await getRecipientByToken({ token }).catch(() => null);

  if (!foundRecipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const envelope = foundRecipient.envelope;

  const [branding] = await Promise.all([
    loadRecipientBrandingByTeamId({
      teamId: foundRecipient.envelope.teamId,
    }),
    viewedDocument({
      token,
    }),
  ]);

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
    isSenderDisabled: false,
    version: 1,
    payload: payloadV1,
    branding,
  } as const);
};

export default function SigningPage() {
  const loaderData = useSuperLoaderData<typeof loader>();
  const cspNonce = useCspNonce();

  const { branding } = loaderData;
  const user = useOptionalSession();

  if (loaderData.version === 1) {
    const { payload } = loaderData;
    const { document, recipient, allRecipients } = payload;

    if (recipient.signingStatus === SigningStatus.SIGNED) {
      return (
        <>
          <AuthenticatedHeader />
          <RecipientBranding branding={branding} />

          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="flex flex-col items-center gap-y-6 px-4 text-center">
              <img className="h-64 w-auto lg:h-80" src={signingCelebration} alt="Signing celebration" />

              <div className="flex flex-col gap-y-4">
                <h1 className="text-3xl font-bold lg:text-4xl">
                  <Trans>Document signed!</Trans>
                </h1>

                <p className="text-muted-foreground text-lg">
                  <Trans>
                    Thank you for signing "{document.title}". We have successfully recorded your signature and emailed
                    you a copy of the document for your records.
                  </Trans>
                </p>

                {user && (
                  <div className="flex justify-center">
                    <Link to="/documents" className="hover:text-primary underline">
                      <Trans>View your documents</Trans>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      );
    }

    if (isRecipientExpired(recipient)) {
      return (
        <>
          <AuthenticatedHeader />
          <RecipientBranding branding={branding} />

          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="flex flex-col items-center gap-y-6 px-4 text-center">
              <div className="border-border text-muted-foreground/80 rounded-full border p-4">
                <Clock8 className="h-12 w-12" />
              </div>

              <div className="flex flex-col gap-y-4">
                <h1 className="text-3xl font-bold lg:text-4xl">
                  <Trans>Document expired</Trans>
                </h1>

                <p className="text-muted-foreground text-lg">
                  <Trans>This document has expired and can no longer be signed.</Trans>
                </p>

                {user && (
                  <div className="flex justify-center">
                    <Link to="/documents" className="hover:text-primary underline">
                      <Trans>View your documents</Trans>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      );
    }

    return (
      <EnvelopeRenderProvider>
        <DocumentSigningAuthProvider
          derivedRecipientActionAuth={payload.derivedRecipientActionAuth}
          recipient={recipient}
        >
          <DocumentSigningAuthPageView user={user} recipient={recipient} branding={branding}>
            <DocumentSigningProvider
              document={document}
              recipient={recipient}
              allRecipients={allRecipients}
              signatures={payload.signatures}
              completedFields={payload.completedFields}
              branding={branding}
            >
              <DocumentSigningPageViewV1 user={user} />
            </DocumentSigningProvider>
          </DocumentSigningAuthPageView>
        </DocumentSigningAuthProvider>
      </EnvelopeRenderProvider>
    );
  }

  const { payload } = loaderData;

  if (payload.csc?.state === 'blocked') {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
        <CscRecipientBlockedPage code={payload.csc.code} />
      </>
    );
  }

  if (payload.csc?.state === 'signing-in-progress') {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
        <CscRecipientSigningInProgressPage sessionId={payload.csc.sessionId} />
      </>
    );
  }

  if (loaderData.isSenderDisabled) {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
        <DocumentSigningSenderDisabledPage />
      </>
    );
  }

  if (!payload.isDocumentAccessValid || !payload.envelopeForSigning) {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />

        <div className="flex flex-1 flex-col items-center justify-center">
          <SigningCard3D className="rotate-6 opacity-50 grayscale" />

          <div className="text-muted-foreground text-lg">
            <Trans>This document is not available.</Trans>
          </div>
        </div>
      </>
    );
  }

  const { envelopeForSigning } = payload;

  return (
    <EnvelopeRenderProvider>
      <EnvelopeSigningProvider envelope={envelopeForSigning}>
        <DocumentSigningPageViewV2
          user={user}
          branding={branding}
          csp={{
            nonce: cspNonce,
          }}
        />
      </EnvelopeSigningProvider>
    </EnvelopeRenderProvider>
  );
}