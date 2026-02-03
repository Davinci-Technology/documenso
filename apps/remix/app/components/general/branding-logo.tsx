import type { HTMLAttributes } from 'react';

import LogoImage from '@documenso/assets/logo.png';

export type LogoProps = HTMLAttributes<HTMLImageElement> & {
  className?: string;
};

export const BrandingLogo = ({ className, ...props }: LogoProps) => {
  return <img src={LogoImage} alt="Davinci Sign" className={className} {...props} />;
};
