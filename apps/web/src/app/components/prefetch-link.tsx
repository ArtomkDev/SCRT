'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

// Warm only links the user is approaching; full pages remain in the router cache.
export function PrefetchLink({ onMouseEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  const [active, setActive] = useState(false);
  return <Link {...props} prefetch={active ? true : false}
    onMouseEnter={(event) => { setActive(true); onMouseEnter?.(event); }}
    onFocus={(event) => { setActive(true); onFocus?.(event); }}
    onTouchStart={(event) => { setActive(true); onTouchStart?.(event); }} />;
}
