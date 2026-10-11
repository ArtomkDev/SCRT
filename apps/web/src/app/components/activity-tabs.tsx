'use client';
import { ScreenTabs } from './screen-tabs';

export function ActivityTabs({ guildId }: { guildId: string }) {
  const root = `/servers/${guildId}/activity`;
  const entries: Array<[string, string]> = [
    ['', 'Огляд'], ['/leaderboard', 'Рейтинг'], ['/games', 'Ігри та застосунки'], ['/voice', 'Voice'], ['/messages', 'Повідомлення'], ['/members', 'Учасники'], ['/settings', 'Налаштування'],
  ];
  return <ScreenTabs label="Модуль активності" entries={entries.map(([suffix, label]) => ({ href: `${root}${suffix}`, label, nested: Boolean(suffix) }))} />;
}
