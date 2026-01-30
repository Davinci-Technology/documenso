import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';

export const appMetaTags = (title?: string) => {
  const description =
    'Davinci ESign - Professional electronic signature solution by Davinci AI Solutions. Fast, secure, and easy document signing for businesses. Streamline your workflow with our powerful e-signature platform.';

  return [
    {
      title: title ? `${title} - Davinci ESign` : 'Davinci ESign',
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'keywords',
      content:
        'Davinci ESign, electronic signature, document signing, e-signature, digital signature, Davinci AI Solutions, secure signing, business documents',
    },
    {
      name: 'author',
      content: 'Davinci AI Solutions',
    },
    {
      name: 'robots',
      content: 'index, follow',
    },
    {
      property: 'og:title',
      content: 'Davinci ESign - Professional Electronic Signature Solution',
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
    {
      property: 'og:type',
      content: 'website',
    },
    {
      name: 'twitter:card',
      content: 'summary_large_image',
    },
    {
      name: 'twitter:site',
      content: '@davincisolutions',
    },
    {
      name: 'twitter:description',
      content: description,
    },
    {
      name: 'twitter:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
  ];
};
