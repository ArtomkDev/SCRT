'use client';

import { ScreenTabs } from './screen-tabs';

export function VoiceTabs({ guildId }: { guildId: string }) {
  const root = `/servers/${guildId}/voice`;
  const entries: Array<[string, string]> = [
    ['Огляд', root], ['Канали створення', `${root}/creators`], ['Активні кімнати', `${root}/rooms`],
    ['Панелі керування', `${root}/interfaces`], ['Налаштування', `${root}/settings`], ['Дозволи', `${root}/permissions`],
  ];
  return <ScreenTabs label="Голосовий модуль" entries={entries.map(([label, href]) => ({ href, label, nested: href !== root }))} />;
}
