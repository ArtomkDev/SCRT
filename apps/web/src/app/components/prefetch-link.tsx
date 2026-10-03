'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

// Warm the route shell on intent without running every dynamic page's reads on hover.
export function PrefetchLink({ onMouseEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  const [active, setActive] = useState(false);
  return <Link {...props} prefetch={active ? 'auto' : false}
    onMouseEnter={(event) => { setActive(true); onMouseEnter?.(event); }}
    onFocus={(event) => { setActive(true); onFocus?.(event); }}
    onTouchStart={(event) => { setActive(true); onTouchStart?.(event); }} />;
}
