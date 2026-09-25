import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { i18n, type MessageDescriptor } from '@lingui/core';

export const appMetaTags = (title?: MessageDescriptor | string) => {
  const description =
    'Davinci Sign is the electronic signature platform from Davinci AI Solutions. Send, sign, and seal agreements with a verifiable audit trail, so your documents move without waiting on paper.';

  const resolvedTitle = typeof title === 'string' ? title : title ? i18n._(title) : '';

  return [
    {
      title: resolvedTitle ? `${resolvedTitle} - Davinci Sign` : 'Davinci Sign',
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'keywords',
      content:
        'Davinci Sign, electronic signature, document signing, e-signature, digital signature, Davinci AI Solutions, secure signing, business documents',
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
      content: 'Davinci Sign - Electronic Signatures by Davinci AI Solutions',
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
