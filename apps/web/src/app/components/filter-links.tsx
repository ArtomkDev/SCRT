import { PrefetchLink } from './prefetch-link';

type FilterLink = Readonly<{ id: string; label: string; href?: string; current?: boolean }>;

export function FilterLinks({ label, entries, className = '' }: { label: string; entries: readonly FilterLink[]; className?: string }) {
  return <nav className={`dashboard-filter-links ${className}`} aria-label={label}>
    {entries.map(({ id, label: title, href, current }) => href
      ? <PrefetchLink key={id} href={href} aria-current={current ? 'page' : undefined}>{title}</PrefetchLink>
      : <span key={id} className="loading-tab">{title}</span>)}
  </nav>;
}
