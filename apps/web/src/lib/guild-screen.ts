import type { AppPermission } from '@scrt/permissions';
import { activityGameKeySchema, activityMetricSchema, activityPeriodSchema, snowflakeSchema } from '@scrt/validation';

type GuildScreen = { path: string; permission: AppPermission; gameKey?: string; userId?: string };
type SearchValues = { get: (key: string) => string | null };

const activityScreens = new Set(['activity', 'activity/leaderboard', 'activity/games', 'activity/voice', 'activity/messages', 'activity/members', 'activity/settings']);
const voiceScreens = new Set(['voice', 'voice/creators', 'voice/interfaces', 'voice/rooms', 'voice/permissions', 'voice/settings']);

export function parseGuildScreen(value: unknown): GuildScreen | null {
  if (typeof value !== 'string') return null;
  if (activityScreens.has(value)) return { path: value, permission: 'activity.view' };
  if (voiceScreens.has(value)) return { path: value, permission: 'voice.view' };
  if (['media', 'media/history', 'media/settings', 'media/sources', 'media/diagnostics'].includes(value)) return { path: value, permission: 'media.view' };
  if (value === 'settings/access-control') return { path: value, permission: 'settings.view' };
  const game = value.match(/^activity\/games\/([^/]+)$/u);
  if (game) {
    let key = game[1]!;
    if (!activityGameKeySchema.safeParse(key).success) {
      try { key = decodeURIComponent(key); } catch { return null; }
    }
    const parsed = activityGameKeySchema.safeParse(key);
    return parsed.success ? { path: `activity/games/${encodeURIComponent(parsed.data)}`, permission: 'activity.view', gameKey: parsed.data } : null;
  }
  const member = value.match(/^activity\/members\/(\d{17,20})$/u);
  return member ? { path: value, permission: 'activity.view', userId: member[1]! } : null;
}

export function guildScreenSearch(path: string, search: SearchValues): URLSearchParams {
  const result = new URLSearchParams();
  if (path === 'activity' || path.startsWith('activity/')) {
    const period = activityPeriodSchema.safeParse(search.get('period'));
    if (period.success) result.set('period', period.data);
  }
  if (path === 'activity/leaderboard') {
    const metric = activityMetricSchema.safeParse(search.get('metric'));
    if (metric.success) result.set('metric', metric.data);
  }
  if (path === 'activity/members') {
    const query = search.get('q');
    if (query && query.length <= 64) result.set('q', query);
  }
  return result;
}

export function guildSwitchHref(guildId: string, pathname: string, search: SearchValues): string {
  const base = `/servers/${snowflakeSchema.parse(guildId)}`;
  const current = pathname.match(/^\/servers\/(\d{17,20})\/(.+)$/u);
  const screen = parseGuildScreen(current?.[2]);
  if (!screen) return base;
  const query = guildScreenSearch(screen.path, search);
  if (current?.[1] === guildId) return `${base}/${screen.path}${query.size ? '?' + query : ''}`;
  query.set('screen', screen.path);
  return `${base}?${query}`;
}
