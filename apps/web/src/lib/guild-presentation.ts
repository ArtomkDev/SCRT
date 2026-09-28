import { installUrl, type DiscordGuild } from '@scrt/discord';

export type ManageableGuild = Pick<DiscordGuild, 'id' | 'name' | 'icon'> & { installed: boolean };

export function groupGuilds(guilds: readonly DiscordGuild[], installedIds: ReadonlySet<string>) {
  const sorted = guilds.map((guild): ManageableGuild => ({ id: guild.id, name: guild.name, icon: guild.icon, installed: installedIds.has(guild.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  return { installed: sorted.filter((guild) => guild.installed), available: sorted.filter((guild) => !guild.installed) };
}

export function guildIconUrl(id: string, icon: string | null, size = 128): string | null {
  if (!icon) return null;
  const format = icon.startsWith('a_') ? 'gif' : 'webp';
  return `https://cdn.discordapp.com/icons/${id}/${icon}.${format}?size=${size}`;
}

export function guildInitials(name: string): string {
  return name.trim().split(/\s+/u).slice(0, 2).map((word) => [...word][0]?.toLocaleUpperCase('uk') ?? '').join('') || '?';
}

export function guildAction(guild: ManageableGuild, clientId: string) {
  return guild.installed
    ? { label: 'Керувати', href: `/servers/${guild.id}` }
    : { label: 'Додати бота', href: installUrl(clientId, guild.id) };
}
