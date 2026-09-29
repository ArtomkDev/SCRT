'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function DashboardNav({ guildId, showVoice = false, showAccess = false }: { guildId?: string; showVoice?: boolean; showAccess?: boolean }) {
  const pathname = usePathname();
  const base = guildId ? `/servers/${guildId}` : '';
  const entries: Array<[string, string]> = guildId
    ? [
      ...(showVoice ? [['Голосові канали', `${base}/voice`] as [string, string]] : []),
      ...(showAccess ? [['Керування доступом', `${base}/settings/access-control`] as [string, string]] : []),
    ]
    : [['Сервери', '/servers']];
  return <nav aria-label={guildId ? 'Розділи сервера' : 'Основна навігація'} className="nav-list">
    {entries.map(([label, href]) => <Link key={href} href={href} prefetch={false} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined} className="nav-link">{label}</Link>)}
  </nav>;
}
