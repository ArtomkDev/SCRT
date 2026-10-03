import type { ComponentProps } from 'react';
import { PrefetchLink } from './prefetch-link';
import { NavigationIcon } from './navigation-icon';

export function InlineAction({ children, className = '', direction = 'forward', ...props }: ComponentProps<typeof PrefetchLink> & { direction?: 'forward' | 'back' }) {
  return <PrefetchLink {...props} className={`inline-action ${className}`}>
    {direction === 'back' && <NavigationIcon kind="chevron-left" />}
    <span>{children}</span>
    {direction === 'forward' && <NavigationIcon kind="chevron-right" />}
  </PrefetchLink>;
}
