'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function VoiceTabs({ guildId }: { guildId: string }) {
  const pathname = usePathname();
  const root = `/servers/${guildId}/voice`;
  const entries: Array<[string, string]> = [
    ['Огляд', root], ['Creator-канали', `${root}/creators`], ['Активні кімнати', `${root}/rooms`],
    ['Інтерфейси', `${root}/interfaces`], ['Налаштування', `${root}/settings`], ['Дозволи', `${root}/permissions`],
  ];
  return <nav className="voice-tabs" aria-label="Голосовий модуль">
    {entries.map(([label, href]) => <Link key={href} href={href} prefetch={false} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}
  </nav>;
}
