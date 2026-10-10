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

  if (!isAccessAuthValid) {
    const requiredAccessData = await getEnvelopeRequiredAccessData({
      token,
      recipientAccessAuth: derivedRecipientAccessAuth,
    });

    return {
      isDocumentAccessValid: false,
      requiredAccessData,
      recipient,
    };
  }

  let signatures = recipient.readOnly ? [] : await getRecipientSignatures({ token });

  if (recipientWithFields.readOnly) {
    const recipientSignatures =
      recipient.role === RecipientRole.ASSISTANT
        ? await getRecipientSignatures({ token, recipientId: recipient.id, includeOnlyReadOnly: true })
        : [];
    signatures = recipientSignatures;
  }

  if (recipient.role === RecipientRole.CC) {
    await viewedDocument({ recipientId: recipient.id });
  }

  return {
    isDocumentAccessValid: true,
    document,
    recipient: recipientWithFields,
    allRecipients,
    nextRecipient,
    fields,
    completedFields,
    signatures,
    requestMetadata,
  };
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();

  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [envelopeForSigning, recipient] = await Promise.all([
    getEnvelopeForRecipientSigning({
      token,
      userId: user?.id,
      withSignedFieldsOnly: false,
    }).catch(() => null),
    getRecipientByToken({ token }).catch(() => null),
  ]);

  if (!envelopeForSigning || !recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const { envelope, derivedRecipientAccessAuth } = envelopeForSigning;

  const isAccessAuthValid = derivedRecipientAccessAuth.every((accesssAuth) =>
    match(accesssAuth)
      .with(DocumentAccessAuth.ACCOUNT, () => user && user.email === recipient.email)
      .with(DocumentAccessAuth.TWO_FACTOR_AUTH, () => true) // Allow without account requirement
      .exhaustive(),
  );

  if (!isAccessAuthValid) {
    const requiredAccessData = await getEnvelopeRequiredAccessData({
      token,
      recipientAccessAuth: derivedRecipientAccessAuth,
    }).catch(() => null);

    return {
      isDocumentAccessValid: false,
      envelopeForSigning,
      csc: { state: 'none' } as const,
    };
  }

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
    csc: { state: 'none' } as const,
  };
};

export const loader = async (loaderArgs: Route.LoaderArgs) => {
  const { params } = loaderArgs;

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const foundRecipient = await getRecipientByToken({ token }).catch(() => null);

  if (!foundRecipient) {
    throw new Response('Not Found', { status: 404 });
  }

  if (isRecipientExpired(foundRecipient)) {
    throw new Response('Gone', { status: 410 });
  }

  const branding = foundRecipient.envelope.teamId
    ? await loadRecipientBrandingByTeamId({
        teamId: foundRecipient.envelope.teamId,
      })
    : null;

  const isSenderDisabled =
    (
      await getUserByEmail({
        email: foundRecipient.envelope.User.email,
      }).catch(() => null)
    )?.disabled === true;

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
        isSenderDisabled,
        version: 2,
        payload: payloadV2,
        branding,
      } as const,
      responseHeaders ? { headers: responseHeaders } : undefined,
    );
  }

  const payloadV1 = await handleV1Loader(loaderArgs);

  return superLoaderJson({
    isSenderDisabled,
    version: 1,
    payload: payloadV1,
    branding,
  } as const);
};

export default function SigningPage() {
  const { version, payload, isSenderDisabled, branding } = useSuperLoaderData<typeof loader>();

  const nonce = useCspNonce();

  // Document signing is sender disabled - prevent access.
  if (isSenderDisabled) {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
        <DocumentSigningSenderDisabledPage />
      </>
    );
  }

  if (version === 1) {
    return <V1SigningPage payload={payload} branding={branding} nonce={nonce} />;
  }

  if (version === 2) {
    return <V2SigningPage payload={payload} branding={branding} nonce={nonce} />;
  }

  return null;
}

type V1SigningPageProps = {
  payload: Awaited<ReturnType<typeof handleV1Loader>>;
  branding: Awaited<ReturnType<typeof loadRecipientBrandingByTeamId>>;
  nonce: string | undefined;
};

function V1SigningPage({ payload, branding, nonce }: V1SigningPageProps) {
  if (!payload.isDocumentAccessValid) {
    return (
      <DocumentSigningAuthProvider
        authPageView={DocumentSigningAuthPageView.SIGN}
        token={payload.requiredAccessData.token}
        recipientAccessAuth={payload.requiredAccessData.recipientAccessAuth}
        recipient={payload.recipient}
      >
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
      </DocumentSigningAuthProvider>
    );
  }

  const {
    document,
    fields,
    completedFields,
    recipient,
    allRecipients,
    nextRecipient,
    signatures,
    requestMetadata,
  } = payload;

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: document.authOptions,
    recipientAuth: recipient.authOptions,
  });

  return (
    <DocumentSigningProvider
      document={document}
      recipient={recipient}
      allRecipients={allRecipients}
      nextRecipient={nextRecipient}
      fields={fields}
      completedFields={completedFields}
      signatures={signatures}
      documentAuthOption={document.authOptions}
      derivedRecipientAccessAuth={derivedRecipientAccessAuth}
    >
      <AuthenticatedHeader />
      <RecipientBranding branding={branding} />
      <EnvelopeRenderProvider
        documentData={document.documentData}
        metadata={document.documentMeta}
        disableSignaturePadZoom={requestMetadata?.devices.includes('mobile')}
        nonce={nonce}
      >
        <DocumentSigningPageViewV1 />
      </EnvelopeRenderProvider>
    </DocumentSigningProvider>
  );
}

type V2SigningPageProps = {
  payload: Awaited<ReturnType<typeof handleV2Loader>>;
  branding: Awaited<ReturnType<typeof loadRecipientBrandingByTeamId>>;
  nonce: string | undefined;
};

function V2SigningPage({ payload, branding, nonce }: V2SigningPageProps) {
  const session = useOptionalSession();

  if (!payload.isDocumentAccessValid) {
    const {
      envelopeForSigning: {
        envelope: {
          Recipient: [recipient],
        },
      },
    } = payload;

    return (
      <DocumentSigningAuthProvider
        authPageView={DocumentSigningAuthPageView.SIGN}
        token={recipient.token}
        recipientAccessAuth={payload.envelopeForSigning.derivedRecipientAccessAuth}
        recipient={recipient}
      >
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
      </DocumentSigningAuthProvider>
    );
  }

  // CSC-specific routing.
  if (payload.csc.state === 'blocked') {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
        <CscRecipientBlockedPage code={payload.csc.code} />
      </>
    );
  } else if (payload.csc.state === 'signing-in-progress') {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />
        <CscRecipientSigningInProgressPage
          envelopeForSigning={payload.envelopeForSigning}
          cscSessionId={payload.csc.sessionId}
        />
      </>
    );
  }

  const { envelopeForSigning, csc } = payload;
  const { envelope } = envelopeForSigning;

  const {
    Recipient: [recipient],
  } = envelope;

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    const signedFields = recipient.Field.filter(({ inserted }) => inserted);

    return (
      <div className="bg-[#1A98CF]/10 pb-8">
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />

        <main className="mx-auto flex max-w-6xl flex-col items-center gap-8 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <img src={signingCelebration} alt="Celebration" className="max-h-[40vh] w-auto" />

            <h1 className="text-5xl font-semibold">
              <Trans>Document Signed!</Trans>
            </h1>

            <p className="max-w-[60ch] text-lg leading-normal text-slate-600">
              <Trans>
                You have successfully signed the document, and all parties will receive a copy once
                complete.
              </Trans>
            </p>

            {envelopeForSigning.completedAt && (
              <Link
                to={`/sign/${recipient.token}/complete`}
                className="bg-documenso-500 hover:bg-documenso-600 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:shadow-md"
              >
                <Trans>Download Completed Document</Trans>
              </Link>
            )}
          </div>

          <div className="bg-background mx-auto w-full max-w-screen-lg rounded-lg border">
            <EnvelopeRenderProvider
              documentData={envelope.documentData}
              metadata={envelope.documentMeta}
              nonce={nonce}
            >
              <SigningCard3D
                name={recipient.name}
                signature=""
                signingCelebration={false}
                fields={signedFields}
                signedFieldsMeta={{}}
                onComplete={() => {}}
              />
            </EnvelopeRenderProvider>
          </div>
        </main>
      </div>
    );
  }

  if (recipient.role === RecipientRole.CC) {
    return (
      <>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />

        <main className="mx-auto max-w-6xl p-8">
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <h1 className="text-4xl font-semibold">
              <Trans>Viewing Document</Trans>
            </h1>

            <p className="max-w-[60ch] text-lg leading-normal text-slate-600">
              <Trans>
                You are viewing this document as a carbon copy recipient. You are not required to
                take any action.
              </Trans>
            </p>

            {envelopeForSigning.completedAt && (
              <Link
                to={`/sign/${recipient.token}/complete`}
                className="bg-documenso-500 hover:bg-documenso-600 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:shadow-md"
              >
                <Trans>Download Completed Document</Trans>
              </Link>
            )}
          </div>

          <div className="bg-background mx-auto w-full max-w-screen-lg rounded-lg border">
            <EnvelopeRenderProvider
              documentData={envelope.documentData}
              metadata={envelope.documentMeta}
              nonce={nonce}
            >
              <DocumentSigningPageViewV2 />
            </EnvelopeRenderProvider>
          </div>
        </main>
      </>
    );
  }

  if (recipient.signingStatus === SigningStatus.PENDING && recipient.role !== RecipientRole.CC) {
    const { derivedRecipientAccessAuth } = envelopeForSigning;

    const hasRecipientSigned = recipient.Field.some((field) => field.inserted);

    if (!hasRecipientSigned) {
      const isRecipientsTurnToSign =
        envelope.status === DocumentStatus.PENDING &&
        ((envelope.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL &&
          envelope.Recipient.findIndex((r) => r.id === recipient.id) ===
            envelope.Recipient.findIndex((r) => r.signingStatus === SigningStatus.PENDING)) ||
          envelope.documentMeta?.signingOrder === DocumentSigningOrder.PARALLEL);

      if (!isRecipientsTurnToSign) {
        return (
          <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center p-8 text-center">
            <Clock8 className="text-muted-foreground mb-4 h-16 w-16" />

            <h1 className="mb-4 text-3xl font-bold">
              <Trans>Not Your Turn Yet</Trans>
            </h1>

            <p className="text-muted-foreground max-w-md text-lg">
              <Trans>
                This document is being signed in order. You'll receive an email when it's your
                turn.
              </Trans>
            </p>

            <Link
              to="/"
              className="bg-documenso-500 hover:bg-documenso-600 mt-6 rounded-lg px-6 py-3 text-white transition-colors"
            >
              <Trans>Go Home</Trans>
            </Link>
          </div>
        );
      }
    }

    return (
      <EnvelopeSigningProvider envelope={envelope} recipient={recipient} user={session?.user || null}>
        <AuthenticatedHeader />
        <RecipientBranding branding={branding} />

        <main className="mx-auto max-w-6xl p-8">
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <h1 className="text-4xl font-semibold">
              <Trans>Please sign this document</Trans>
            </h1>

            <p className="max-w-[60ch] text-lg leading-normal text-slate-600">
              <Trans>
                Review the document below and add your signature and other required information.
              </Trans>
            </p>
          </div>

          <div className="bg-background mx-auto w-full max-w-screen-lg rounded-lg border">
            <EnvelopeRenderProvider
              documentData={envelope.documentData}
              metadata={envelope.documentMeta}
              nonce={nonce}
            >
              <DocumentSigningPageViewV2 />
            </EnvelopeRenderProvider>
          </div>
        </main>
      </EnvelopeSigningProvider>
    );
  }

  throw new Response('Forbidden', { status: 403 });
}