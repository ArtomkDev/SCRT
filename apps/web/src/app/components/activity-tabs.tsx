'use client';
import { usePathname } from 'next/navigation';
import { PrefetchLink } from './prefetch-link';

export function ActivityTabs({ guildId }: { guildId: string }) {
  const path = usePathname();
  const root = `/servers/${guildId}/activity`;
  return <nav className="voice-tabs" aria-label="Модуль активності">{[['', 'Огляд'], ['/leaderboard', 'Рейтинг'], ['/games', 'Ігри та застосунки'], ['/voice', 'Voice'], ['/messages', 'Повідомлення'], ['/members', 'Учасники'], ['/settings', 'Налаштування']].map(([suffix, title]) => {
    const href = `${root}${suffix}`;
    return <PrefetchLink key={href} href={href} aria-current={path === href || suffix && path.startsWith(`${href}/`) ? 'page' : undefined}>{title}</PrefetchLink>;
  })}</nav>;
}
