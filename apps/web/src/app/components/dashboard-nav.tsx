'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function DashboardNav({ guildId }: { guildId?: string }) {
  const pathname = usePathname();
  const base = guildId ? `/servers/${guildId}` : '';
  const entries: Array<[string, string]> = guildId
    ? [
      ['Огляд', base], ['Учасники', `${base}/members`], ['Активність', `${base}/activity`],
      ['Голосові канали', `${base}/voice`], ['Модерація', `${base}/moderation`],
      ['Автоматизація', `${base}/automation`], ['Журнал', `${base}/logs`],
      ['Налаштування', `${base}/settings`], ['Керування доступом', `${base}/settings/access-control`],
    ]
    : [['Огляд', '/dashboard'], ['Сервери', '/servers']];
  return <nav aria-label={guildId ? 'Розділи сервера' : 'Основна навігація'} className="nav-list">
    {entries.map(([label, href]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined} className="nav-link">{label}</Link>)}
  </nav>;
}
