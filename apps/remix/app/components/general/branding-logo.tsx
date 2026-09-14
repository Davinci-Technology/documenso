import LogoImage from '@documenso/assets/logo.svg';
import LogoImageWhite from '@documenso/assets/logo-white.svg';
import { cn } from '@documenso/ui/lib/utils';
import type { HTMLAttributes } from 'react';

export type LogoProps = HTMLAttributes<HTMLImageElement> & {
  className?: string;
};

/**
 * Davinci Sign product lockup (emblem + Davinci script + SIGN) from the
 * Marketing brand library. Colour variant on light backgrounds, white variant
 * on dark backgrounds, per the Visual Identity guideline (May 2025). The app
 * toggles themes with a `.dark` class (remix-themes), so both variants are
 * rendered and Tailwind's `dark:` variant picks the visible one.
 */
export const BrandingLogo = ({ className, ...props }: LogoProps) => {
  return (
    <>
      <img src={LogoImage} alt="Davinci Sign" className={cn('dark:hidden', className)} {...props} />
      <img src={LogoImageWhite} alt="Davinci Sign" className={cn('hidden dark:block', className)} {...props} />
    </>
  );
};
