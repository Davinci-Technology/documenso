import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

import { Body, Container, Head, Html, Img, Preview, Section } from '../components';
import { useBranding } from '../providers/branding';
import { TemplateBrandingLogo } from '../template-components/template-branding-logo';
import { TemplateDocumentRejected } from '../template-components/template-document-rejected';
import { TemplateFooter } from '../template-components/template-footer';

type DocumentRejectedEmailProps = {
  recipientName: string;
  documentName: string;
  documentUrl: string;
  rejectionReason: string;
  assetBaseUrl?: string;
};

export function DocumentRejectedEmail({
  recipientName,
  documentName,
  documentUrl,
  rejectionReason,
  assetBaseUrl = 'http://localhost:3002',
}: DocumentRejectedEmailProps) {
  const { _ } = useLingui();
  const branding = useBranding();

  const previewText = _(msg`${recipientName} has rejected the document '${documentName}'`);

  return (
    <Html>
      <Head />
      <Body className="mx-auto my-auto bg-background font-sans">
        <Preview>{previewText}</Preview>

        <Section>
          <Container className="mx-auto mb-2 mt-8 max-w-xl rounded-lg border border-solid border-border p-4 backdrop-blur-sm">
            <Section>
              {branding.brandingEnabled && branding.brandingLogo ? (
                <Img src={branding.brandingLogo} alt="Branding Logo" className="mb-4 h-6" />
              ) : (
                <TemplateBrandingLogo assetBaseUrl={assetBaseUrl} className="mb-4 h-6" />
              )}

              <TemplateDocumentRejected
                recipientName={recipientName}
                documentName={documentName}
                documentUrl={documentUrl}
                rejectionReason={rejectionReason}
              />
            </Section>
          </Container>

          <Container className="mx-auto max-w-xl">
            <TemplateFooter />
          </Container>
        </Section>
      </Body>
    </Html>
  );
}

export default DocumentRejectedEmail;
