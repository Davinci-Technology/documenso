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

  if (isDocumentAccessValid && derivedRecipientAccessAuth.includes(DocumentAccessAuth.TWO_FACTOR_AUTH)) {
    const { hostname } = new URL(request.url);

    const docAuthBypass = new URL(`/sign/${token}/auth`, `http://${hostname}`);

    const verified = docAuthBypass.searchParams.get('verified') === 'true';

    if (!verified) {
      isDocumentAccessValid = false;
    }
  }

  if (!isDocumentAccessValid && document.completedAt === null) {
    const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
      documentAuth: document.authOptions,
      recipientAuth: recipient.authOptions,
    });

    return {
      authOptions: derivedRecipientAccessAuth,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      requiresPasscode: derivedRecipientAccessAuth.includes(DocumentAccessAuth.TWO_FACTOR_AUTH),
      document,
      isDocumentAccessValid,
    };
  }

  const completedRequiredSignatures = await getRecipientSignatures({
    recipientId: recipient.id,
  });

  const senderUser = await getUserByEmail({ email: document.User.email });

  const remainingRecipients = allRecipients.filter(
    ({ id, signingStatus }) =>
      id !== recipient.id && [SigningStatus.PENDING, SigningStatus.NOT_SIGNED].includes(signingStatus),
  );

  const isWaitingForOthers = remainingRecipients.length > 0;

  let possibleCelebrationStep = false;
  let showCompleteDocument = false;

  if (
    !isWaitingForOthers &&
    fields.length === completedFields.length &&
    completedRequiredSignatures.length > 0
  ) {
    showCompleteDocument = true;
  }

  if (document.completedAt !== null) {
    possibleCelebrationStep = true;
  }

  // We delegate the blocking-error page to the V2 loader so that the error
  // handling can be unified in a single place (the `Loader` component).
  let senderDisabled = false;

  try {
    await assertSenderNotDisabled({ userId: document.User.id });
  } catch (error) {
    if (error instanceof AppError && error.code === 'ACCOUNT_DISABLED') {
      senderDisabled = true;
    } else {
      // Re-throw any other errors (e.g., database connection issues, other AppErrors)
      throw error;
    }
  }

  return {
    document,
    user,
    recipient: recipientWithFields,
    allRecipients,
    fields,
    completedFields,
    isDocumentAccessValid,
    isWaitingForOthers,
    possibleCelebrationStep,
    showCompleteDocument,
    senderDisabled,
    nextRecipient,
    signature: completedRequiredSignatures.at(0),
    senderUser,
  };
};

const handleV2Loader = async ({
  params,
  request,
}: Route.LoaderArgs): Promise<
  | {
      isDocumentAccessValid: false;
      authOptions: DocumentAccessAuth[];
      recipientEmail: string;
      recipientName: string;
      requiresPasscode: boolean;
      user: Awaited<ReturnType<typeof getOptionalSession>>['user'];
    }
  | {
      isDocumentAccessValid: true;
      envelopeForSigning: Awaited<ReturnType<typeof getEnvelopeForRecipientSigning>>;
      csc?: { state: 'blocked'; code: string } | { state: 'signing-in-progress'; sessionId: string };
      responseHeaders?: { 'Set-Cookie': string };
    }
> => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const envelopeForSigning = await getEnvelopeForRecipientSigning({
    token,
    userId: user?.id,
  }).catch(() => null);

  if (!envelopeForSigning) {
    throw new Response('Not Found', { status: 404 });
  }

  const { envelope, recipient } = envelopeForSigning;

  // `getEnvelopeForRecipientSigning` short-circuits the envelope validity check
  // in DRAFT mode (see docstring), but the UI is not designed to handle
  // the DRAFT state. Run the broader access check to determine if the
  // recipient is allowed to see this envelope.
  const requiredAccessData = getEnvelopeRequiredAccessData(envelope);

  const isValidDocumentAccess = requiredAccessData.every((accessData) => {
    return match(accessData)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => {
        const { pathname, searchParams } = new URL(request.url);
        return pathname.endsWith('/auth') && searchParams.get('verified') === 'true';
      })
      .exhaustive();
  });

  if (!isValidDocumentAccess) {
    return {
      isDocumentAccessValid: false,
      authOptions: requiredAccessData,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      requiresPasscode: requiredAccessData.includes(DocumentAccessAuth.TWO_FACTOR_AUTH),
      user,
    };
  }

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  await viewedDocument({
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

export const loader = async (loaderArgs: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { token } = loaderArgs.params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const foundRecipient = await getRecipientByToken({ token }).catch(() => null);

  if (!foundRecipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const isRecipientExpiredState = isRecipientExpired(foundRecipient.expiresAt);

  if (isRecipientExpiredState) {
    throw redirect(`/sign/${token}/expired`);
  }

  const branding = await loadRecipientBrandingByTeamId({
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
    isSenderDisabled: payloadV1.senderDisabled,
    version: 1,
    payload: payloadV1,
    branding,
  } as const);
};

export default function RecipientSigningPage() {
  const data = useSuperLoaderData<typeof loader>();
  const nonce = useCspNonce();

  const sessionData = useOptionalSession();

  const showNotSignedInHeader = !sessionData?.user && data.version === 2;

  if (data.version === 1) {
    const { senderDisabled, payload } = data;

    if (senderDisabled) {
      return <DocumentSigningSenderDisabledPage />;
    }

    if (!payload.isDocumentAccessValid) {
      return (
        <DocumentSigningAuthProvider authOptions={payload.authOptions}>
          <DocumentSigningAuthPageView
            requiresPasscode={payload.requiresPasscode}
            recipientEmail={payload.recipientEmail}
            recipientName={payload.recipientName}
          />
        </DocumentSigningAuthProvider>
      );
    }

    return (
      <>
        {showNotSignedInHeader && (
          <AuthenticatedHeader>
            <Trans>Davinci Sign</Trans>
          </AuthenticatedHeader>
        )}

        <main className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
          <DocumentSigningProvider
            document={payload.document}
            recipient={payload.recipient}
            completedFields={payload.completedFields}
            signatures={payload.signature ? [payload.signature] : []}
            allRecipients={payload.allRecipients}
            nextRecipient={payload.nextRecipient}
          >
            <DocumentSigningPageViewV1
              isWaitingForOthers={payload.isWaitingForOthers}
              possibleCelebrationStep={payload.possibleCelebrationStep}
              showCompleteDocument={payload.showCompleteDocument}
            />
          </DocumentSigningProvider>
        </main>

        <RecipientBranding branding={data.branding} />
      </>
    );
  }

  if (data.version === 2) {
    const { payload } = data;

    if (!payload.isDocumentAccessValid) {
      return (
        <DocumentSigningAuthProvider authOptions={payload.authOptions}>
          <DocumentSigningAuthPageView
            requiresPasscode={payload.requiresPasscode}
            recipientEmail={payload.recipientEmail}
            recipientName={payload.recipientName}
          />
        </DocumentSigningAuthProvider>
      );
    }

    const { envelopeForSigning } = payload;
    const { envelope } = envelopeForSigning;

    if (payload.csc) {
      if (payload.csc.state === 'blocked') {
        return (
          <CscRecipientBlockedPage
            code={payload.csc.code}
            envelopeTspProvider={envelope.tspProvider}
            recipient={envelopeForSigning.recipient}
            envelope={envelope}
          />
        );
      }

      if (payload.csc.state === 'signing-in-progress') {
        return (
          <CscRecipientSigningInProgressPage
            sessionId={payload.csc.sessionId}
            recipientToken={envelopeForSigning.recipient.token}
          />
        );
      }
    }

    return (
      <EnvelopeRenderProvider envelope={envelope}>
        {showNotSignedInHeader && (
          <AuthenticatedHeader>
            <Trans>Davinci Sign</Trans>
          </AuthenticatedHeader>
        )}

        <main className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
          <EnvelopeSigningProvider envelopeForSigning={envelopeForSigning}>
            <DocumentSigningPageViewV2 />
          </EnvelopeSigningProvider>
        </main>

        <RecipientBranding branding={data.branding} />
      </EnvelopeRenderProvider>
    );
  }

  return (
    <div className="dark:bg-background flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="relative">
          <SigningCard3D className="h-48 w-48" />

          <div className="absolute inset-0 flex items-center justify-center">
            <Clock8 className="text-muted-foreground/50 h-24 w-24" />
          </div>
        </div>

        <h1 className="text-4xl font-semibold">
          <Trans>Something went wrong!</Trans>
        </h1>

        <p className="text-muted-foreground mt-4">
          <Trans>We were unable to display this document. Please contact support if this persists.</Trans>
        </p>

        <Link
          to="https://davincisolutions.ai"
          className="text-documenso-700 mt-4 inline-block font-medium hover:underline"
        >
          <Trans>Return to Davinci Sign</Trans>
        </Link>
      </div>

      <img
        src={signingCelebration}
        alt="Signing Celebration"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-5"
      />

      <script
        nonce={nonce}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: We need to set the initial value
        dangerouslySetInnerHTML={{
          __html: `window.partytownDebug = ${process.env.NODE_ENV === 'development'}`,
        }}
      />
    </div>
  );
}