import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), ranking: vi.fn(), game: vi.fn(), players: vi.fn(), profiles: vi.fn(), settings: vi.fn(), gameTime: vi.fn(), memberGameTime: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('./guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('./server', () => ({ activity: () => ({ profiles: mocks.profiles }), activityLeaderboards: () => ({ memberLeaderboard: mocks.ranking, game: mocks.game, gamePlayers: mocks.players, getSettings: mocks.settings, gameTimeTotal: mocks.gameTime, memberGameTimeTotal: mocks.memberGameTime }) }));

import { activityGame, activityGamePlayers, activityGameTimeTotal, activityMemberGameTimeTotal, activityPeriod, activityProfiles, activityRanking, activitySettings } from './activity-data';

const guildId = '12345678901234567';
const first = { userId: '22345678901234567', rank: 1, value: 3 };
const second = { userId: '32345678901234567', rank: 2, value: 2 };

describe('Activity page data loading', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({});
    mocks.profiles.mockResolvedValue([]);
  });

  it('loads one ranking without waiting for unrelated page data', async () => {
    mocks.ranking.mockResolvedValue([first, second]);
    await expect(activityRanking(guildId, 'messages', 'today')).resolves.toEqual([first, second]);
    expect(mocks.ranking).toHaveBeenCalledExactlyOnceWith(guildId, 'messages', 'today', 25);
  });

  it('rejects unauthorized loads before starting private data reads', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(activityRanking(guildId, 'messages', 'all')).rejects.toThrow('Forbidden');
    await expect(activityProfiles(guildId, first.userId)).rejects.toThrow('Forbidden');
    await expect(activityGameTimeTotal(guildId, 'all')).rejects.toThrow('Forbidden');
    await expect(activityMemberGameTimeTotal(guildId, first.userId, 'all')).rejects.toThrow('Forbidden');
    expect(mocks.ranking).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
    expect(mocks.gameTime).not.toHaveBeenCalled();
    expect(mocks.memberGameTime).not.toHaveBeenCalled();
  });

  it('uses the same request-scoped settings source as leaderboard queries', async () => {
    mocks.settings.mockResolvedValue({ enabled: true });
    await expect(activitySettings(guildId)).resolves.toEqual({ enabled: true });
    expect(mocks.settings).toHaveBeenCalledExactlyOnceWith(guildId);
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.view');
  });
});

describe('Activity query state and detail authorization', () => {
  it.each(['today', '7d', '30d', 'all'] as const)('parses canonical %s', (period) => expect(activityPeriod(period)).toBe(period));
  it.each([undefined, 'bad', ['7d'], '7D'])('defaults missing or invalid period %s to all time', (period) => expect(activityPeriod(period)).toBe('all'));
  it('guards game summaries and contributors before private queries', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(activityGame(guildId, 'name:dota 2', '7d')).rejects.toThrow('Forbidden');
    await expect(activityGamePlayers(guildId, 'name:dota 2', '7d')).rejects.toThrow('Forbidden');
    expect(mocks.game).not.toHaveBeenCalled(); expect(mocks.players).not.toHaveBeenCalled();
  });
  it('forwards guild and selected period to both detail queries', async () => {
    mocks.access.mockResolvedValue({});
    await activityGame(guildId, 'name:dota 2', '30d');
    await activityGamePlayers(guildId, 'name:dota 2', '30d');
    expect(mocks.game).toHaveBeenCalledWith(guildId, 'name:dota 2', '30d');
    expect(mocks.players).toHaveBeenCalledWith(guildId, 'name:dota 2', '30d');
  });
});
