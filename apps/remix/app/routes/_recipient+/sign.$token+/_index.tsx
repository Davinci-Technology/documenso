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
  } catch (error) {
    isSenderDisabled = true;
  }

  if (isAccessAuthValid && isSenderDisabled) {
    return {
      isDocumentAccessValid: true,
      derivedRecipientAccessAuth,
      isSenderDisabled: true,
      authRedirectUrl: '',
      recipient: recipientWithFields,
      documentSignatureId: recipient.documentSignatureId,
    };
  }

  if (!isAccessAuthValid && user) {
    if (user.email === recipient.email) {
      const authRedirectUrl = `/sign/${token}`;

      return {
        isDocumentAccessValid: false,
        derivedRecipientAccessAuth,
        authRedirectUrl,
        recipient: recipientWithFields,
        documentSignatureId: recipient.documentSignatureId,
      };
    }
  }

  if (!isAccessAuthValid && !user) {
    if (derivedRecipientAccessAuth.includes(DocumentAccessAuth.ACCOUNT)) {
      const authRedirectUrl = `/sign/${token}`;

      return {
        isDocumentAccessValid: false,
        derivedRecipientAccessAuth,
        authRedirectUrl,
        recipient: recipientWithFields,
        documentSignatureId: recipient.documentSignatureId,
      };
    }
  }

  const signatures = await getRecipientSignatures({ token });

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    throw redirect(`/sign/${token}/complete`);
  }

  if (isRecipientExpired(recipient) && document.documentMeta.expiresAt && document.documentMeta.expiresAt < new Date()) {
    throw new AppError(AppErrorCode.DOCUMENT_SIGNING_EXPIRED);
  }

  await viewedDocument({
    token,
    ipAddress: requestMetadata?.ipAddress,
    userAgent: requestMetadata?.userAgent,
  });

  return {
    isDocumentAccessValid: true,
    derivedRecipientAccessAuth,
    recipient: recipientWithFields,
    document,
    allRecipients,
    nextRecipient,
    completedFields,
    signatures,
    documentSignatureId: recipient.documentSignatureId,
  };
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const recipient = await getRecipientByToken({ token }).catch(() => null);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  let isSenderDisabled = false;

  try {
    const envelope = await prisma.envelope.findUnique({
      where: { id: recipient.envelopeId },
      select: { userId: true },
    });

    if (!envelope) {
      throw new Response('Not Found', { status: 404 });
    }

    await assertSenderNotDisabled({ userId: envelope.userId });
  } catch (error) {
    if (error instanceof AppError && error.code === AppErrorCode.ACCOUNT_DISABLED) {
      isSenderDisabled = true;
    }
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: recipient.envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isAccessAuthValid = derivedRecipientAccessAuth.every((accesssAuth) =>
    match(accesssAuth)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => true) // Allow without account requirement
      .exhaustive(),
  );

  if (isAccessAuthValid && isSenderDisabled) {
    return {
      isDocumentAccessValid: true,
      derivedRecipientAccessAuth,
      isSenderDisabled: true,
      authRedirectUrl: '',
      recipient,
      documentSignatureId: recipient.documentSignatureId,
    };
  }

  if (!isAccessAuthValid && user) {
    if (user.email === recipient.email) {
      const authRedirectUrl = `/sign/${token}`;

      return {
        isDocumentAccessValid: false,
        derivedRecipientAccessAuth,
        authRedirectUrl,
        recipient,
        documentSignatureId: recipient.documentSignatureId,
      };
    }
  }

  if (!isAccessAuthValid && !user) {
    if (derivedRecipientAccessAuth.includes(DocumentAccessAuth.ACCOUNT)) {
      const authRedirectUrl = `/sign/${token}`;

      return {
        isDocumentAccessValid: false,
        derivedRecipientAccessAuth,
        authRedirectUrl,
        recipient,
        documentSignatureId: recipient.documentSignatureId,
      };
    }
  }

  const envelopeForSigning = await getEnvelopeForRecipientSigning({
    token,
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
  if (IS_INSTANCE_CSC_MODE() && isTspEnvelope(envelopeForSigning)) {
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

export const loader = async (loaderArgs: Route.LoaderArgs) => {
  const { token } = loaderArgs.params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const foundRecipient = await getRecipientByToken({ token }).catch(() => null);

  if (!foundRecipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const branding = await loadRecipientBrandingByTeamId({
    recipientEmail: foundRecipient.email,
    teamId: foundRecipient.envelope.teamId,
  });

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

const DocumentSigningPageV1 = ({ payload }: { payload: Awaited<ReturnType<typeof handleV1Loader>> }) => {
  const nonce = useCspNonce();

  if (payload.isSenderDisabled) {
    return <DocumentSigningSenderDisabledPage recipient={payload.recipient} />;
  }

  if (!payload.isDocumentAccessValid) {
    return (
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="flex min-h-screen w-full items-center justify-center">
          <div className="flex w-full max-w-lg flex-col items-center">
            <DocumentSigningAuthProvider authOptions={payload.derivedRecipientAccessAuth} />

            <DocumentSigningAuthPageView recipient={payload.recipient} authRedirectUrl={payload.authRedirectUrl} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* This nonce is injected by CSP middleware, make sure to never hardcode */}
      <style nonce={nonce} suppressHydrationWarning>
        {`
          .customScrollbar::-webkit-scrollbar {
            width: 12px;
          }

          .customScrollbar::-webkit-scrollbar-track {
            background: hsl(var(--border));
          }

          .customScrollbar::-webkit-scrollbar-thumb {
            background: hsl(var(--documenso-600));
            border-radius: 4px;
          }
        `}
      </style>

      <div className="flex h-screen flex-col">
        <AuthenticatedHeader hideUserButtons />

        <div className="flex h-full w-full items-center justify-center overflow-y-auto">
          <div className="w-full max-w-screen-xl">
            <DocumentSigningProvider
              recipientToken={payload.recipient.token}
              recipient={payload.recipient}
              document={payload.document}
              allRecipients={payload.allRecipients}
              signatures={payload.signatures}
              completedFields={payload.completedFields}
              nextRecipient={payload.nextRecipient}
            >
              <DocumentSigningPageViewV1 />
            </DocumentSigningProvider>
          </div>
        </div>
      </div>
    </div>
  );
};

const DocumentSigningPageV2 = ({ payload }: { payload: Awaited<ReturnType<typeof handleV2Loader>> }) => {
  const nonce = useCspNonce();

  if ('csc' in payload) {
    return match(payload.csc.state)
      .with('blocked', () => <CscRecipientBlockedPage code={payload.csc.code} />)
      .with('signing-in-progress', () => (
        <CscRecipientSigningInProgressPage envelopeForSigning={payload.envelopeForSigning} sessionId={payload.csc.sessionId} />
      ))
      .exhaustive();
  }

  if (payload.isSenderDisabled) {
    return <DocumentSigningSenderDisabledPage recipient={payload.recipient} />;
  }

  if (!payload.isDocumentAccessValid) {
    return (
      <div className="mx-auto max-w-screen-xl px-4">
        <div className="flex min-h-screen w-full items-center justify-center">
          <div className="flex w-full max-w-lg flex-col items-center">
            <DocumentSigningAuthProvider authOptions={payload.derivedRecipientAccessAuth} />

            <DocumentSigningAuthPageView recipient={payload.recipient} authRedirectUrl={payload.authRedirectUrl} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* This nonce is injected by CSP middleware, make sure to never hardcode */}
      <style nonce={nonce} suppressHydrationWarning>
        {`
          .customScrollbar::-webkit-scrollbar {
            width: 12px;
          }

          .customScrollbar::-webkit-scrollbar-track {
            background: hsl(var(--border));
          }

          .customScrollbar::-webkit-scrollbar-thumb {
            background: hsl(var(--documenso-600));
            border-radius: 4px;
          }
        `}
      </style>

      <EnvelopeRenderProvider envelope={payload.envelopeForSigning}>
        <EnvelopeSigningProvider envelope={payload.envelopeForSigning}>
          <DocumentSigningPageViewV2 />
        </EnvelopeSigningProvider>
      </EnvelopeRenderProvider>
    </>
  );
};

const DocumentSigningPage = () => {
  const data = useSuperLoaderData<typeof loader>();

  const { payload, version } = data;

  return match(version)
    .with(1, () => <DocumentSigningPageV1 payload={payload} />)
    .with(2, () => <DocumentSigningPageV2 payload={payload} />)
    .exhaustive();
};

const WaitingCard = ({ recipientExpectedAt }: { recipientExpectedAt?: Date | null }) => (
  <div className="mx-auto max-w-lg">
    <SigningCard3D className="mx-auto h-32 w-32" />

    <div className="text-center">
      <h1 className="text-2xl font-medium text-slate-900">
        <Trans>Please wait</Trans>
      </h1>

      <p className="text-muted-foreground mt-4">
        <Trans>
          We're still waiting on other recipients to sign this document. You'll receive an email once it's your turn.
        </Trans>
      </p>

      {recipientExpectedAt && (
        <div className="border-muted text-muted-foreground mt-6 flex flex-col items-center gap-y-4 rounded-lg border p-4">
          <Clock8 className="h-12 w-12" />

          <div>
            <p className="text-sm font-medium">
              <Trans>Expected signing date</Trans>
            </p>

            <p className="text-sm">{recipientExpectedAt.toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="mt-8">
        <Link to="/" className="bg-documenso hover:bg-documenso/80 inline-flex items-center rounded-lg px-6 py-3 text-white">
          <Trans>Go back home</Trans>
        </Link>
      </div>
    </div>
  </div>
);

const CompletedCard = () => (
  <div className="mx-auto max-w-lg">
    <img src={signingCelebration} alt="Signing Celebration" className="dark:invert" />

    <div className="text-center">
      <h1 className="text-2xl font-medium text-slate-900">
        <Trans>Completed!</Trans>
      </h1>

      <p className="text-muted-foreground mt-4">
        <Trans>This document has been signed by all parties.</Trans>
      </p>

      <div className="mt-8">
        <Link to="/" className="bg-documenso hover:bg-documenso/80 inline-flex items-center rounded-lg px-6 py-3 text-white">
          <Trans>Go back home</Trans>
        </Link>
      </div>
    </div>
  </div>
);

export default function SigningPage() {
  const data = useSuperLoaderData<typeof loader>();

  return (
    <RecipientBranding branding={data.branding}>
      <DocumentSigningPage />
    </RecipientBranding>
  );
}