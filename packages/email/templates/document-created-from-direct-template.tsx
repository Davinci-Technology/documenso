import { RECIPIENT_ROLES_DESCRIPTION } from '@documenso/lib/constants/recipient-roles';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { RecipientRole } from '@prisma/client';

import { Body, Button, Container, Head, Html, Img, Preview, Section, Text } from '../components';
import { useBranding } from '../providers/branding';
import { TemplateBrandingLogo } from '../template-components/template-branding-logo';
import TemplateDocumentImage from '../template-components/template-document-image';
import { TemplateFooter } from '../template-components/template-footer';

export type DocumentCompletedEmailTemplateProps = {
  recipientName?: string;
  recipientRole?: RecipientRole;
  documentLink?: string;
  documentName?: string;
  assetBaseUrl?: string;
};

export const DocumentCreatedFromDirectTemplateEmailTemplate = ({
  recipientName = 'John Doe',
  recipientRole = RecipientRole.SIGNER,
  documentLink = 'http://localhost:3000',
  documentName = 'Open Source Pledge.pdf',
  assetBaseUrl = 'http://localhost:3002',
}: DocumentCompletedEmailTemplateProps) => {
  const { _ } = useLingui();
  const branding = useBranding();

  const action = _(RECIPIENT_ROLES_DESCRIPTION[recipientRole].actioned).toLowerCase();

  const previewText = msg`Document created from direct template`;

  return (
    <Html>
      <Head />
      <Body className="mx-auto my-auto font-sans">
        <Preview>{_(previewText)}</Preview>

        <Section className="bg-background">
          <Container className="mx-auto mb-2 mt-8 max-w-xl rounded-lg border border-solid border-border p-2 backdrop-blur-sm">
            <Section className="p-2">
              {branding.brandingEnabled && branding.brandingLogo ? (
                <Img src={branding.brandingLogo} alt="Branding Logo" className="mb-4 h-6" />
              ) : (
                <TemplateBrandingLogo assetBaseUrl={assetBaseUrl} className="mb-4 h-6" />
              )}

              <TemplateDocumentImage className="mt-6" assetBaseUrl={assetBaseUrl} />

              <Section>
                <Text className="mb-0 text-center text-lg font-semibold text-foreground">
                  <Trans>
                    {recipientName} {action} a document by using one of your direct links
                  </Trans>
                </Text>

                <div className="mx-auto my-2 w-fit rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
                  {documentName}
                </div>

                <Section className="my-6 text-center">
                  <Button
                    className="inline-flex items-center justify-center rounded-lg bg-documenso-500 px-6 py-3 text-center text-sm font-medium text-black no-underline"
                    href={documentLink}
                  >
                    <Trans>View document</Trans>
                  </Button>
                </Section>
              </Section>
            </Section>
          </Container>

          <Container className="mx-auto max-w-xl">
            <TemplateFooter />
          </Container>
        </Section>
      </Body>
    </Html>
  );
};

export default DocumentCreatedFromDirectTemplateEmailTemplate;
