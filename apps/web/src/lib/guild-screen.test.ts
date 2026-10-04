import { describe, expect, it } from 'vitest';
import { guildScreenSearch, guildSwitchHref, parseGuildScreen } from './guild-screen';

const source = '12345678901234567', target = '22345678901234567';

describe('guild screen navigation', () => {
  it.each(['app:356875988589740042', 'name:dota 2', 'name:100% / українська', 'name:literal%3Avalue'])('preserves encoded game identity %s across guilds', (gameKey) => {
    const href = guildSwitchHref(target, `/servers/${source}/activity/games/${encodeURIComponent(gameKey)}`, new URLSearchParams('period=7d'));
    const url = new URL(href, 'https://scrt.example');
    expect(parseGuildScreen(url.searchParams.get('screen'))?.gameKey).toBe(gameKey);
    expect(url.searchParams.get('period')).toBe('7d');
    expect(url.pathname).toBe(`/servers/${target}`);
  });

  it('preserves ranking metric and period but resets guild-specific cursors', () => {
    const href = guildSwitchHref(target, `/servers/${source}/activity/leaderboard`, new URLSearchParams('period=30d&metric=voiceSeconds&after=123&next=https://evil.example'));
    const url = new URL(href, 'https://scrt.example');
    expect(Object.fromEntries(url.searchParams)).toEqual({ period: '30d', metric: 'voiceSeconds', screen: 'activity/leaderboard' });
  });

  it('preserves member search but drops its cursor', () => {
    expect(guildScreenSearch('activity/members', new URLSearchParams('q=Іван&after=123')).toString()).toBe(new URLSearchParams({ q: 'Іван' }).toString());
  });

  it('uses the default server entry outside a supported guild screen', () => {
    expect(guildSwitchHref(target, '/servers', new URLSearchParams())).toBe(`/servers/${target}`);
    expect(guildSwitchHref(target, `/servers/${source}/activity/artwork/123`, new URLSearchParams())).toBe(`/servers/${target}`);
  });

  it('drops malformed and repeated query values and prevents arbitrary destinations', () => {
    expect(guildScreenSearch('activity/leaderboard', new URLSearchParams('period=bad&metric=bad')).size).toBe(0);
    for (const value of ['//evil.example', 'voice/../../settings', 'activity/games/name%3A', 'activity/members/123', 'activity/games/name%253Adota']) expect(parseGuildScreen(value)).toBeNull();
  });
});
