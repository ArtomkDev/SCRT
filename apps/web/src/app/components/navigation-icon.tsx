import type { SVGProps } from 'react';

// Small shared navigation glyphs; the dashboard has no icon-library dependency.
export function NavigationIcon({ kind, ...props }: SVGProps<SVGSVGElement> & { kind: 'chevron-right' | 'chevron-left' | 'chevron-down' | 'plus' | 'retry' }) {
  const paths = { 'chevron-right': 'm9 5 7 7-7 7', 'chevron-left': 'm15 5-7 7 7 7', 'chevron-down': 'm5 9 7 7 7-7', plus: 'M12 5v14M5 12h14', retry: 'M20 7v5h-5M20 12a8 8 0 1 0-2 5M20 12a8 8 0 0 0-2-5' };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[kind]} /></svg>;
}
