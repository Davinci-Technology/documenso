import { SOURCE_CODE_URL } from '@documenso/lib/constants/app';
import { cn } from '@documenso/ui/lib/utils';
import { Trans } from '@lingui/react/macro';
import { Code2 } from 'lucide-react';

export type SourceCodeFooterProps = {
  className?: string;
};

/**
 * In-app offer of the corresponding source code.
 *
 * Required by section 13 of the GNU AGPL-3.0: because this is a modified
 * Documenso instance offered to users over a network, those users must be
 * given an opportunity to receive its complete corresponding source. Rendering
 * this in the network-facing layouts (app shell, recipient/signing, and the
 * unauthenticated pages) satisfies that "standard and customary means".
 */
export const SourceCodeFooter = ({ className }: SourceCodeFooterProps) => {
  return (
    <footer className={cn('text-muted-foreground/80 mt-auto py-6 text-center text-xs', className)}>
      <a
        href={SOURCE_CODE_URL()}
        target="_blank"
        rel="noreferrer noopener"
        className="hover:text-muted-foreground inline-flex items-center gap-1.5 transition-colors"
      >
        <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
        <Trans>Source code</Trans>
      </a>
      <span className="mx-1.5" aria-hidden="true">
        ·
      </span>
      <span>
        <Trans>Licensed under AGPL-3.0</Trans>
      </span>
    </footer>
  );
};
