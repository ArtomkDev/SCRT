'use client';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import { PrefetchLink } from './prefetch-link';

export type ScreenTab = Readonly<{ href: string; label: string; nested?: boolean }>;

export function ScreenTabs({ entries, label }: { entries: readonly ScreenTab[]; label: string }) {
  const pathname = usePathname();
  const navigation = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; width: number; height: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  const entrySignature = JSON.stringify(entries);
  // Select the most specific match; a module's overview never shadows a child.
  const active = entries.filter(({ href, nested }) => pathname === href || nested && pathname.startsWith(`${href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const ready = Boolean(position && active);
  // First appearance is immediate; later route changes retarget a single CSS tween.
  useEffect(() => {
    if (!ready) { setAnimate(false); return; }
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  useLayoutEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const measure = () => {
      const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current) { setPosition(null); return; }
      if (!nav.clientWidth) return;
      const viewport = nav.getBoundingClientRect(), tab = current.getBoundingClientRect();
      if (tab.left < viewport.left) nav.scrollTo({ left: nav.scrollLeft + tab.left - viewport.left - 12 });
      else if (tab.right > viewport.right) nav.scrollTo({ left: nav.scrollLeft + tab.right - viewport.right + 12 });
      const rect = current.getBoundingClientRect();
      const next = { left: rect.left - viewport.left + nav.scrollLeft, width: rect.width, height: rect.height };
      if (!next.width || !next.height) return;
      setPosition((previous) => previous?.left === next.left && previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(nav);
    nav.querySelectorAll('a').forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [active, entrySignature]);
  const indicatorStyle = { ...(position ? { '--tab-left': `${position.left}px`, '--tab-width': `${position.width}px`, '--tab-height': `${position.height}px` } : {}), transition: animate ? undefined : 'none' } as CSSProperties;
  return <nav ref={navigation} className="dashboard-screen-tabs" aria-label={label} data-indicator-ready={ready}>
    <span className="dashboard-screen-tab-indicator" aria-hidden="true" style={indicatorStyle} />
    {entries.map(({ href, label: title }) => <PrefetchLink key={href} href={href} aria-current={href === active ? 'page' : undefined}>{title}</PrefetchLink>)}
  </nav>;
}
