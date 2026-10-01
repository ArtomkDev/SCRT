'use client';

import { PrefetchLink } from './prefetch-link';
import { usePathname } from 'next/navigation';

export function VoiceTabs({ guildId }: { guildId: string }) {
  const pathname = usePathname();
  const root = `/servers/${guildId}/voice`;
  const entries: Array<[string, string]> = [
    ['Огляд', root], ['Канали створення', `${root}/creators`], ['Активні кімнати', `${root}/rooms`],
    ['Панелі керування', `${root}/interfaces`], ['Налаштування', `${root}/settings`], ['Дозволи', `${root}/permissions`],
  ];
  return <nav className="voice-tabs" aria-label="Голосовий модуль">
    {entries.map(([label, href]) => <PrefetchLink key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</PrefetchLink>)}
  </nav>;
}
