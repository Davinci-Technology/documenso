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

  if (!isAccessAuthValid) {
    const requiredAccessData = await getEnvelopeRequiredAccessData({
      envelopeId: document.id,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      user,
    }).catch(() => null);

    const isRecipientExpiredBool = isRecipientExpired(recipient);

    const teamSettings = requiredAccessData?.team?.id
      ? await getTeamSettings({
          teamId: requiredAccessData.team.id,
        })
      : null;

    const branding = await loadRecipientBrandingByTeamId({
      teamId: teamSettings?.teamId,
    });

    return {
      isDocumentAccessValid: false,
      derivedRecipientAccessAuth,
      recipient: recipientWithFields,
      document,
      requestMetadata,
      user,
      teamSettings,
      isRecipientExpiredBool,
      branding,
      isSenderDisabled,
    };
  }

  await viewedDocument({ token });

  const signatures = await getRecipientSignatures({
    documentId: document.id,
    recipientId: recipient.id,
  });

  const teamSettings = document.team?.id
    ? await getTeamSettings({
        teamId: document.team.id,
      })
    : null;

  const branding = await loadRecipientBrandingByTeamId({
    teamId: teamSettings?.teamId,
  });

  return {
    isDocumentAccessValid: true,
    recipient: recipientWithFields,
    document,
    requestMetadata,
    user,
    allRecipients,
    nextRecipient,
    signatures,
    completedFields,
    teamSettings,
    branding,
    isSenderDisabled,
  };
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { requestMetadata } = getOptionalLoaderContext();
  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [envelope, recipient] = await Promise.all([
    getEnvelopeForRecipientSigning({
      token: token,
      userId: user?.id,
    }).catch(() => null),
    getRecipientByToken({ token }).catch(() => null),
  ]);

  if (!envelope || !recipient || envelope.status === DocumentStatus.DRAFT) {
    throw new Response('Not Found', { status: 404 });
  }

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
    envelope.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL
      ? await getNextPendingRecipient({
          documentId: envelope.id,
          currentRecipientId: recipient.id,
        })
      : null;

  // Only the identity is needed client-side (dictation flag + prefill).
  const nextRecipient = nextPendingRecipient
    ? { name: nextPendingRecipient.name, email: nextPendingRecipient.email }
    : null;

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

  if (!isAccessAuthValid) {
    const requiredAccessData = await getEnvelopeRequiredAccessData({
      envelopeId: envelope.id,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      user,
    }).catch(() => null);

    const isRecipientExpiredBool = isRecipientExpired(recipient);

    const teamSettings = requiredAccessData?.team?.id
      ? await getTeamSettings({
          teamId: requiredAccessData.team.id,
        })
      : null;

    const branding = await loadRecipientBrandingByTeamId({
      teamId: teamSettings?.teamId,
    });

    return {
      isDocumentAccessValid: false,
      derivedRecipientAccessAuth,
      envelopeForSigning: envelope,
      recipient,
      requestMetadata,
      user,
      teamSettings,
      isRecipientExpiredBool,
      branding,
      isSenderDisabled,
    } as const;
  }

  const envelopeForSigning = await getEnvelopeForRecipientSigning({
    token: token,
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
    recipient,
    requestMetadata,
    user,
    allRecipients,
    nextRecipient,
    teamSettings: null,
    branding: null,
    isSenderDisabled,
  } as const;
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

  const branding = await loadRecipientBrandingByTeamId({
    teamId: foundRecipient.envelope.team?.id,
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
    isSenderDisabled: payloadV1.isSenderDisabled,
    version: 1,
    payload: payloadV1,
    branding,
  } as const);
};

export default function SigningPage() {
  const data = useSuperLoaderData<typeof loader>();
  const cspNonce = useCspNonce();

  if (data.version === 2) {
    return (
      <EnvelopeRenderProvider>
        <RecipientBranding branding={data.branding} cspNonce={cspNonce} />
        <VersionTwoSigningComponent payload={data.payload} />
      </EnvelopeRenderProvider>
    );
  }

  return (
    <EnvelopeRenderProvider>
      <RecipientBranding branding={data.branding} cspNonce={cspNonce} />
      <VersionOneSigningComponent payload={data.payload} />
    </EnvelopeRenderProvider>
  );
}

const VersionOneSigningComponent = ({ payload }: { payload: Awaited<ReturnType<typeof handleV1Loader>> }) => {
  const session = useOptionalSession();

  if (payload.isSenderDisabled) {
    return (
      <DocumentSigningSenderDisabledPage
        document={payload.document}
        user={payload.user}
        recipient={payload.recipient}
      />
    );
  }

  if (!payload.isDocumentAccessValid) {
    return (
      <DocumentSigningAuthProvider
        user={payload.user}
        recipient={payload.recipient}
        document={payload.document}
        derivedRecipientAccessAuth={payload.derivedRecipientAccessAuth}
        isRecipientExpired={payload.isRecipientExpiredBool}
      >
        <DocumentSigningAuthPageView />
      </DocumentSigningAuthProvider>
    );
  }

  if (session) {
    return (
      <>
        <AuthenticatedHeader />
        <DocumentSigningProvider recipient={payload.recipient} allRecipients={payload.allRecipients}>
          <DocumentSigningPageViewV1
            document={payload.document}
            signatures={payload.signatures}
            completedFields={payload.completedFields}
            nextRecipient={payload.nextRecipient}
            teamSettings={payload.teamSettings}
            branding={payload.branding}
          />
        </DocumentSigningProvider>
      </>
    );
  }

  return (
    <DocumentSigningProvider recipient={payload.recipient} allRecipients={payload.allRecipients}>
      <DocumentSigningPageViewV1
        document={payload.document}
        signatures={payload.signatures}
        completedFields={payload.completedFields}
        nextRecipient={payload.nextRecipient}
        teamSettings={payload.teamSettings}
        branding={payload.branding}
      />
    </DocumentSigningProvider>
  );
};

type CscState =
  | { state: 'blocked'; code: string }
  | { state: 'signing-in-progress'; sessionId: string }
  | { state: 'normal' };

const VersionTwoSigningComponent = ({
  payload,
}: {
  payload: Awaited<ReturnType<typeof handleV2Loader>> & { csc?: CscState };
}) => {
  const session = useOptionalSession();

  if ('csc' in payload && payload.csc) {
    if (payload.csc.state === 'blocked') {
      return <CscRecipientBlockedPage code={payload.csc.code} />;
    }

    if (payload.csc.state === 'signing-in-progress') {
      return <CscRecipientSigningInProgressPage sessionId={payload.csc.sessionId} />;
    }
  }

  if (payload.isSenderDisabled) {
    return (
      <DocumentSigningSenderDisabledPage
        envelope={payload.envelopeForSigning || null}
        user={payload.user}
        recipient={payload.recipient}
      />
    );
  }

  if (!payload.isDocumentAccessValid) {
    return (
      <DocumentSigningAuthProvider
        user={payload.user}
        recipient={payload.recipient}
        envelope={payload.envelopeForSigning || null}
        derivedRecipientAccessAuth={payload.derivedRecipientAccessAuth}
        isRecipientExpired={payload.isRecipientExpiredBool}
      >
        <DocumentSigningAuthPageView />
      </DocumentSigningAuthProvider>
    );
  }

  if (!payload.envelopeForSigning) {
    throw new Error('Envelope not found for signing');
  }

  if (session) {
    return (
      <>
        <AuthenticatedHeader />
        <EnvelopeSigningProvider
          envelope={payload.envelopeForSigning}
          recipient={payload.recipient}
          allRecipients={payload.allRecipients}
        >
          <DocumentSigningPageViewV2
            envelope={payload.envelopeForSigning}
            nextRecipient={payload.nextRecipient}
            teamSettings={payload.teamSettings}
            branding={payload.branding}
          />
        </EnvelopeSigningProvider>
      </>
    );
  }

  return (
    <EnvelopeSigningProvider
      envelope={payload.envelopeForSigning}
      recipient={payload.recipient}
      allRecipients={payload.allRecipients}
    >
      <DocumentSigningPageViewV2
        envelope={payload.envelopeForSigning}
        nextRecipient={payload.nextRecipient}
        teamSettings={payload.teamSettings}
        branding={payload.branding}
      />
    </EnvelopeSigningProvider>
  );
};

// Component to display sharing button
function ShareButton({ token }: { token?: string }) {
  const shareableUrl = `${window.location.origin}/sign/${token}`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Document for signing',
          text: 'Sign this document',
          url: shareableUrl,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      // Fallback to clipboard
      try {
        await navigator.clipboard.writeText(shareableUrl);
        // Could show a toast notification here
      } catch (err) {
        console.error('Error copying to clipboard:', err);
      }
    }
  };

  return (
    <button
      onClick={handleShare}
      className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
    >
      Share Document
    </button>
  );
}

// Display a notification when document is shared
function SharedDocumentNotification() {
  return (
    <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative" role="alert">
      <strong className="font-bold">Success!</strong>
      <span className="block sm:inline"> Document has been shared.</span>
    </div>
  );
}

// A simple loading component
function DocumentLoadingSpinner() {
  return (
    <div className="flex justify-center items-center h-screen">
      <SigningCard3D className="h-12 w-12 animate-spin" />
    </div>
  );
}

// Display when document is not available
function DocumentNotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Document Not Found</h1>
      <p className="text-gray-600 mb-8">The document you're looking for could not be found or has been removed.</p>
      <Link to="/" className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
        Go Home
      </Link>
    </div>
  );
}

// Display recipient information
function RecipientInfo({
  recipient,
}: {
  recipient: { name?: string | null; email: string; role: RecipientRole };
}) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg mb-4">
      <h3 className="text-lg font-semibold mb-2">Recipient Information</h3>
      <div className="space-y-1">
        {recipient.name && (
          <p>
            <span className="font-medium">Name:</span> {recipient.name}
          </p>
        )}
        <p>
          <span className="font-medium">Email:</span> {recipient.email}
        </p>
        <p>
          <span className="font-medium">Role:</span> {recipient.role}
        </p>
      </div>
    </div>
  );
}

// Show signing progress
function SigningProgress({
  completedFields,
  totalFields,
}: {
  completedFields: number;
  totalFields: number;
}) {
  const progress = totalFields > 0 ? (completedFields / totalFields) * 100 : 0;

  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm text-gray-600 mb-1">
        <span>Signing Progress</span>
        <span>
          {completedFields} of {totalFields} fields completed
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-in-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// Display document status
function DocumentStatus({ status }: { status: DocumentStatus }) {
  const statusConfig = {
    [DocumentStatus.DRAFT]: { color: 'gray', label: 'Draft' },
    [DocumentStatus.PENDING]: { color: 'yellow', label: 'Pending' },
    [DocumentStatus.COMPLETED]: { color: 'green', label: 'Completed' },
  };

  const config = statusConfig[status] || { color: 'gray', label: 'Unknown' };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${config.color}-100 text-${config.color}-800`}
    >
      {config.label}
    </span>
  );
}

// Display next recipient info
function NextRecipientInfo({ nextRecipient }: { nextRecipient: { name?: string; email: string } | null }) {
  if (!nextRecipient) return null;

  return (
    <div className="bg-blue-50 p-4 rounded-lg mt-4">
      <h4 className="text-sm font-medium text-blue-900 mb-1">Next Recipient</h4>
      <p className="text-sm text-blue-700">
        {nextRecipient.name ? `${nextRecipient.name} (${nextRecipient.email})` : nextRecipient.email}
      </p>
    </div>
  );
}

// Display waiting message
function WaitingForTurn() {
  return (
    <div className="text-center py-12">
      <Clock8 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        <Trans>Waiting for your turn</Trans>
      </h2>
      <p className="text-gray-600">
        <Trans>Please wait while other recipients complete their signing.</Trans>
      </p>
    </div>
  );
}

// Display signing celebration
function SigningCelebration() {
  return (
    <div className="text-center py-12">
      <img src={signingCelebration} alt="Signing celebration" className="h-32 w-32 mx-auto mb-4" />
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        <Trans>Document signed successfully!</Trans>
      </h2>
      <p className="text-gray-600">
        <Trans>Thank you for signing this document.</Trans>
      </p>
    </div>
  );
}

// Error boundary component
function SigningError({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-3xl font-bold text-red-600 mb-4">Signing Error</h1>
      <p className="text-gray-600 mb-8">An error occurred while processing your signing request.</p>
      <details className="bg-gray-100 p-4 rounded-lg mb-4">
        <summary className="cursor-pointer font-medium">Error Details</summary>
        <pre className="mt-2 text-sm text-gray-700">{error.message}</pre>
      </details>
      <button
        onClick={() => window.location.reload()}
        className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
      >
        Retry
      </button>
    </div>
  );
}