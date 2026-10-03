'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

// Warm the route shell on intent without running every dynamic page's reads on hover.
export function PrefetchLink({ onMouseEnter, onMouseLeave, onFocus, onBlur, onTouchStart, onTouchEnd, onTouchCancel, ...props }: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  const [active, setActive] = useState(false);
  return <Link {...props} prefetch={active ? 'auto' : false}
    onMouseEnter={(event) => { setActive(true); onMouseEnter?.(event); }}
    onMouseLeave={(event) => { setActive(false); onMouseLeave?.(event); }}
    onFocus={(event) => { setActive(true); onFocus?.(event); }}
    onBlur={(event) => { setActive(false); onBlur?.(event); }}
    onTouchStart={(event) => { setActive(true); onTouchStart?.(event); }}
    onTouchEnd={(event) => { setActive(false); onTouchEnd?.(event); }}
    onTouchCancel={(event) => { setActive(false); onTouchCancel?.(event); }} />;
}
