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

  let signatures = await getRecipientSignatures({
    recipientId: recipient.id,
  });

  // If the user is logged in, and the recipient email matches the user email
  // we can also include the user's signatures.
  if (user && user.email === recipient.email) {
    const userSignatures = await getRecipientSignatures({
      userId: user.id,
    });

    signatures = [...signatures, ...userSignatures];
  }

  return {
    document: {
      ...document,
      documentData: {
        ...document.documentData,
        data: document.documentData.data.toString('base64'),
      },
    },
    recipient: recipientWithFields,
    signatures,
    allRecipients,
    nextRecipient,
    isAccessAuthValid,
  };
};

const handleV2Loader = async ({ params, request }: Route.LoaderArgs) => {
  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const recipient = await getRecipientByToken({ token }).catch(() => null);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const envelope = await getEnvelopeForRecipientSigning({
    token,
  });

  if (!envelope) {
    throw new Response('Not Found', { status: 404 });
  }

  const isRecipientsTurn = await getIsRecipientsTurnToSign({ token });

  if (!isRecipientsTurn) {
    throw redirect(`/sign/${token}/waiting`);
  }

  const envelopeForSigning = {
    ...envelope,
    documents: envelope.documents.map((document) => ({
      ...document,
      documentData: {
        ...document.documentData,
        data: document.documentData.data.toString('base64'),
      },
    })),
  };

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
    recipient,
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
        include: {
          user: true,
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

  const sender = foundRecipient.envelope.user;

  try {
    assertSenderNotDisabled(sender);
  } catch (e) {
    return superLoaderJson({
      isSenderDisabled: true,
      branding: {
        brandingEnabled: false,
        brandingLogo: '',
      },
    } as const);
  }

  const [branding, teamSettings] = await Promise.all([
    loadRecipientBrandingByTeamId(foundRecipient.envelope.teamId),
    foundRecipient.envelope.teamId
      ? getTeamSettings(foundRecipient.envelope.teamId)
      : Promise.resolve(null),
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

export default function SignDocumentPage() {
  const {
    isSenderDisabled,
    version,
    payload,
    branding = { brandingEnabled: false, brandingLogo: '' },
  } = useSuperLoaderData<typeof loader>();

  const { user } = useOptionalSession();

  const nonce = useCspNonce();

  if (isSenderDisabled) {
    return <DocumentSigningSenderDisabledPage branding={branding} />;
  }

  if (version === 2) {
    const { isDocumentAccessValid, envelopeForSigning, recipient, recipientAccessAuth, csc } =
      payload;

    if (csc?.state === 'blocked') {
      return <CscRecipientBlockedPage code={csc.code} branding={branding} />;
    }

    if (csc?.state === 'signing-in-progress') {
      return (
        <CscRecipientSigningInProgressPage
          recipientToken={recipient.token}
          sessionId={csc.sessionId}
          branding={branding}
        />
      );
    }

    return (
      <DocumentSigningAuthProvider
        recipient={recipient}
        recipientAccessAuth={recipientAccessAuth}
        isDocumentAccessValid={isDocumentAccessValid}
      >
        <EnvelopeSigningProvider envelope={envelopeForSigning}>
          <DocumentSigningProvider recipient={recipient}>
            <RecipientBranding branding={branding}>
              <DocumentSigningPageViewV2 />
            </RecipientBranding>
          </DocumentSigningProvider>
        </EnvelopeSigningProvider>
      </DocumentSigningAuthProvider>
    );
  }

  const { document, recipient, signatures, allRecipients, nextRecipient, isAccessAuthValid } =
    payload;

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    return (
      <div className="flex min-h-screen flex-col bg-background p-4 md:p-8">
        {user ? (
          <AuthenticatedHeader />
        ) : (
          <header className="flex h-16 items-center px-4 md:px-8">
            <Link to="/">
              <img
                src={branding.brandingEnabled && branding.brandingLogo ? branding.brandingLogo : ''}
                alt="Branding Logo"
                className="h-8 w-auto"
              />
            </Link>
          </header>
        )}

        <div className="flex flex-1 items-center justify-center">
          <SigningCard3D
            title={<Trans>All set!</Trans>}
            description={<Trans>You have successfully signed the document.</Trans>}
            image={signingCelebration}
          />
        </div>
      </div>
    );
  }

  return (
    <DocumentSigningAuthProvider
      recipient={recipient}
      recipientAccessAuth={[DocumentAccessAuth.ACCOUNT, DocumentAccessAuth.TWO_FACTOR_AUTH]}
      isDocumentAccessValid={isAccessAuthValid}
    >
      <EnvelopeRenderProvider
        documents={[{ ...document, signatures: [] }]}
        recipients={allRecipients}
      >
        <DocumentSigningProvider recipient={recipient}>
          <RecipientBranding branding={branding}>
            <DocumentSigningPageViewV1
              document={document}
              recipient={recipient}
              signatures={signatures}
              allRecipients={allRecipients}
              nextRecipient={nextRecipient}
            />
          </RecipientBranding>
        </DocumentSigningProvider>
      </EnvelopeRenderProvider>
    </DocumentSigningAuthProvider>
  );
}
