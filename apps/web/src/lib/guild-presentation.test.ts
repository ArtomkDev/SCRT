import { describe, expect, it } from 'vitest';
import type { DiscordGuild } from '@scrt/discord';
import { groupGuilds, guildAction, guildIconUrl, guildInitials } from './guild-presentation';

const guild = (id: string, name: string, icon: string | null = null): DiscordGuild => ({ id, name, icon, owner: true, permissions: '0' });

describe('guild presentation', () => {
  it('groups installed guilds first and sorts each group by name', () => {
    const groups = groupGuilds([guild('2', 'Явір'), guild('3', 'Альфа'), guild('1', 'Бета'), guild('4', 'Вежа')], new Set(['1', '3']));
    expect(groups.installed.map(({ name }) => name)).toEqual(['Альфа', 'Бета']);
    expect(groups.available.map(({ name }) => name)).toEqual(['Вежа', 'Явір']);
    expect(groups.installed.every(({ installed }) => installed)).toBe(true);
    expect(groups.available.every(({ installed }) => !installed)).toBe(true);
  });
  it('forms sized Discord icon URLs and clean initials fallback', () => {
    expect(guildIconUrl('123', 'hash', 64)).toBe('https://cdn.discordapp.com/icons/123/hash.webp?size=64');
    expect(guildIconUrl('123', 'a_hash', 64)).toBe('https://cdn.discordapp.com/icons/123/a_hash.gif?size=64');
    expect(guildIconUrl('123', null)).toBeNull();
    expect(guildInitials('  Ігровий Сервер  ')).toBe('ІС');
    expect(guildInitials(' ')).toBe('?');
  });
  it('retains manage and install destinations for the right state', () => {
    const groups = groupGuilds([guild('123', 'Перший'), guild('456', 'Другий')], new Set(['123']));
    expect(guildAction(groups.installed[0]!, 'client')).toEqual({ label: 'Керувати', href: '/servers/123' });
    const available = guildAction(groups.available[0]!, 'client');
    expect(available.label).toBe('Додати бота');
    const url = new URL(available.href);
    expect(url.searchParams.get('guild_id')).toBe('456');
  });
});
