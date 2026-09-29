/* eslint-disable @typescript-eslint/no-var-requires */
const baseConfig = require('@documenso/tailwind-config');
const path = require('path');

module.exports = {
  ...baseConfig,
  content: [`templates/**/*.{ts,tsx}`],
  theme: {
    ...baseConfig.theme,
    extend: {
      ...baseConfig.theme.extend,
      fontFamily: {
        ...baseConfig.theme.extend.fontFamily,
        // Email clients cannot resolve the app's CSS font variable; use the
        // brand font hierarchy directly (Open Sans, Arial fallback).
        sans: ['Open Sans', 'Arial', 'sans-serif'],
      },
    },
  },
};
