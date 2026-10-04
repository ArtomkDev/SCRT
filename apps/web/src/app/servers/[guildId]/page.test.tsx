import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({ requireGuildAccess: vi.fn(), redirect: vi.fn(), game: vi.fn(), profiles: vi.fn(), identity: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('@/lib/activity-data', () => ({ activityGame: mocks.game, activityProfiles: mocks.profiles, activityMemberIdentity: mocks.identity }));

import GuildHome from './page';

const guildId = '12345678901234567';
describe('server entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('opens Voice when the user can view it', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['voice.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).rejects.toThrow(`redirect:/servers/${guildId}/voice`);
  });

  it('opens Activity first even when Voice is also available', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view', 'voice.view', 'settings.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).rejects.toThrow(`redirect:/servers/${guildId}/activity`);
  });

  it('opens access control when Voice and Activity are unavailable', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).rejects.toThrow(`redirect:/servers/${guildId}/settings/access-control`);
  });

  it('shows an honest empty state when no module is available', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set() });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).resolves.toMatchObject({ type: 'main' });
  });

  it('keeps an existing game and selected period using the target guild history', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view']) });
    mocks.game.mockResolvedValue({ totalSeconds: 3600 });
    await expect(GuildHome({ params: Promise.resolve({ guildId }), searchParams: Promise.resolve({ screen: 'activity/games/name%3Adota%202', period: '7d' }) })).rejects.toThrow(`redirect:/servers/${guildId}/activity/games/name%3Adota%202?period=7d`);
    expect(mocks.game).toHaveBeenCalledExactlyOnceWith(guildId, 'name:dota 2', 'all');
  });

  it('falls back to the games list when the target guild has no such game', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view']) });
    mocks.game.mockResolvedValue(null);
    await expect(GuildHome({ params: Promise.resolve({ guildId }), searchParams: Promise.resolve({ screen: 'activity/games/name%3Adota%202', period: 'today' }) })).rejects.toThrow(`redirect:/servers/${guildId}/activity/games?period=today`);
  });

  it.each([true, false])('keeps a member with saved history: %s', async (historical) => {
    const userId = '22345678901234567';
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view']) });
    mocks.profiles.mockResolvedValue(historical ? [{ userId }] : []);
    mocks.identity.mockResolvedValue({ member: { id: userId } });
    await expect(GuildHome({ params: Promise.resolve({ guildId }), searchParams: Promise.resolve({ screen: `activity/members/${userId}`, period: '30d' }) })).rejects.toThrow(`redirect:/servers/${guildId}/activity/members/${userId}?period=30d`);
    expect(mocks.profiles).toHaveBeenCalledWith(guildId, userId);
    if (historical) expect(mocks.identity).not.toHaveBeenCalled();
    else expect(mocks.identity).toHaveBeenCalledWith(guildId, userId);
  });

  it('falls back to members when the person has neither membership nor history', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view']) });
    mocks.profiles.mockResolvedValue([]);
    mocks.identity.mockResolvedValue({ member: null });
    await expect(GuildHome({ params: Promise.resolve({ guildId }), searchParams: Promise.resolve({ screen: 'activity/members/22345678901234567', period: '7d' }) })).rejects.toThrow(`redirect:/servers/${guildId}/activity/members?period=7d`);
  });

  it('falls back to a permitted module without reading inaccessible activity data', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['voice.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }), searchParams: Promise.resolve({ screen: 'activity/games/name%3Adota' }) })).rejects.toThrow(`redirect:/servers/${guildId}/voice`);
    expect(mocks.game).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example', '../voice', 'activity/games/%E0%A4%A', ['activity'], 'activity/artwork/123'])('ignores invalid or unsupported screen %s', async (screen) => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }), searchParams: Promise.resolve({ screen }) })).rejects.toThrow(`redirect:/servers/${guildId}/activity`);
    expect(mocks.game).not.toHaveBeenCalled();
  });

  it('preserves a permitted Voice tab instead of opening the default module', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view', 'voice.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }), searchParams: Promise.resolve({ screen: 'voice/rooms' }) })).rejects.toThrow(`redirect:/servers/${guildId}/voice/rooms`);
  });
});
