import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireGuildAccess } from '@/lib/guards';

export default async function MediaLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params; await requireGuildAccess(guildId, 'media.view'); const base = `/servers/${guildId}/media`;
  return <main className="content-page content-wide">
    <header className="page-heading"><h1>Медіа</h1><p>Спільне відтворення у голосовому каналі.</p></header>
    <nav className="media-tabs" aria-label="Медіа"><Link href={base}>Плеєр</Link><Link href={`${base}/history`}>Історія</Link><Link href={`${base}/settings`}>Налаштування</Link><Link href={`${base}/sources`}>Джерела</Link><Link href={`${base}/diagnostics`}>Діагностика</Link></nav>
    <div className="media-page">{children}</div>
  </main>;
}
