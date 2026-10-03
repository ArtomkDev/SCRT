import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { activitySessionSchema, activitySettingsSchema } from '@scrt/validation';
import { ActivityRepository, activityKey } from './activity-repository';
import { ActivityLeaderboardService } from './activity-leaderboards';
import { activityTestStore } from './activity-test-store';

const guildId = '12345678901234567';
const userId = '22345678901234567';
const start = Date.parse('2026-10-01T20:30:00Z');
const session = (patch = {}) => activitySessionSchema.parse({ id: randomUUID(), guildId, userId, tracker: 'voice', channelId: '32345678901234567', startedAt: start, cursorAt: start, lastObservedAt: start, qualified: false, timezone: 'Europe/Kyiv', minimumSeconds: 60, streakMinimum: 300, streakEpoch: 'Europe/Kyiv:300:true:0', game: null, schemaVersion: 1, ...patch });
function setup(missingIndexes = false) { const store = activityTestStore(missingIndexes); const repository = new ActivityRepository(store.db); return { ...store, repository, row: (collection: string, id: string) => store.records.get(`guilds/${guildId}/${collection}/${id}`) }; }

describe('continuous Voice records', () => {
  it('accumulates eligible segments without gaps or duplicate checkpoint/start/close counts', async () => {
    const { repository, row } = setup(); const voiceRunEpoch = randomUUID();
    const first = session({ voiceRunEpoch });
    await repository.startSession(first);
    await repository.settleSession(guildId, first.id, start + 120000, true, 60);
    const joined = start + 150000;
    const next = session({ voiceRunEpoch, startedAt: joined, cursorAt: joined, lastObservedAt: joined });
    await repository.startSession(next);
    await repository.settleSession(guildId, next.id, joined + 60000, false);
    await repository.startSession(next);
    await repository.settleSession(guildId, next.id, joined + 60000, false);
    expect(row('activityMembers', userId)).toMatchObject({ voiceSeconds: 180, longestVoiceRunSeconds: 180 });
    await repository.settleSession(guildId, next.id, joined + 120000, true);
    await repository.settleSession(guildId, next.id, joined + 180000, true);
    expect(row('activityMembers', userId)).toMatchObject({ voiceSeconds: 240, longestVoiceRunSeconds: 240 });
    expect((await repository.listSessions(guildId))).toEqual([]);
  });
  it.each(['expired', 'new epoch', 'no grace'] as const)('preserves the historical record but resets after %s', async (reason) => {
    const { repository, row } = setup(); const voiceRunEpoch = randomUUID();
    const first = session({ voiceRunEpoch }); await repository.startSession(first);
    await repository.settleSession(guildId, first.id, start + 120000, true, reason === 'no grace' ? 0 : 60);
    const joined = start + (reason === 'expired' ? 180001 : 130000);
    const next = session({ voiceRunEpoch: reason === 'new epoch' ? randomUUID() : voiceRunEpoch, startedAt: joined, cursorAt: joined, lastObservedAt: joined });
    await repository.startSession(next);
    expect((await repository.listSessions(guildId))[0]!.voiceRunBaseMilliseconds).toBe(0);
    await repository.settleSession(guildId, next.id, joined + 60000, true);
    expect(row('activityMembers', userId)).toMatchObject({ voiceSeconds: 180, longestVoiceRunSeconds: 120 });
  });
  it('qualifies the continuous record from short segments while retaining per-session total thresholds', async () => {
    const { repository, row } = setup(); const voiceRunEpoch = randomUUID();
    const first = session({ voiceRunEpoch }); await repository.startSession(first);
    await repository.settleSession(guildId, first.id, start + 30500, true, 60);
    expect(row('activityMembers', userId)?.longestVoiceRunSeconds).toBe(0);
    const joined = start + 40000;
    const next = session({ voiceRunEpoch, startedAt: joined, cursorAt: joined, lastObservedAt: joined });
    await repository.startSession(next);
    await repository.settleSession(guildId, next.id, joined + 30500, true);
    expect(row('activityMembers', userId)?.longestVoiceRunSeconds).toBe(61);
    expect(row('activityMembers', userId)?.voiceSeconds).toBeUndefined();
  });
  it('never carries another guild’s run and returns zero for legacy member records', async () => {
    const { repository, row } = setup(); const voiceRunEpoch = randomUUID();
    const first = session({ voiceRunEpoch }); await repository.startSession(first);
    await repository.settleSession(guildId, first.id, start + 120000, true, 60);
    const otherGuild = '52345678901234567', joined = start + 130000;
    const next = session({ guildId: otherGuild, voiceRunEpoch, startedAt: joined, cursorAt: joined, lastObservedAt: joined });
    await repository.startSession(next);
    await repository.settleSession(otherGuild, next.id, joined + 60000, true);
    const service = new ActivityLeaderboardService(repository, () => joined);
    expect((await service.member(otherGuild, userId, 'all')).longestVoiceRunSeconds).toBe(60);
    expect(row('activityMembers', userId)?.longestVoiceRunSeconds).toBe(120);
    await repository.flushMessages(guildId, 'legacy', [{ userId: '62345678901234567', date: '2026-10-01', count: 1, observedAt: start }]);
    expect((await service.member(guildId, '62345678901234567', 'all')).longestVoiceRunSeconds).toBe(0);
  });
  it('uses a bounded all-time sorted query for the new metric, including deterministic ties', async () => {
    const { repository, records, queries } = setup();
    for (const [id, value] of [[userId, 900], ['62345678901234567', 900], ['72345678901234567', 0]] as const) records.set(`guilds/${guildId}/activityMembers/${id}`, { userId: id, longestVoiceRunSeconds: value });
    records.set(`guilds/52345678901234567/activityMembers/${userId}`, { userId, longestVoiceRunSeconds: 99999 });
    const service = new ActivityLeaderboardService(repository, () => start);
    expect(await service.memberLeaderboard(guildId, 'longestVoiceRunSeconds', 'today', 2)).toEqual([{ userId: '62345678901234567', value: 900, rank: 1 }, { userId, value: 900, rank: 2 }]);
    expect(queries).toEqual([{ collection: `guilds/${guildId}/activityMembers`, limit: 2, filters: [] }]);
  });
});

describe('atomic Activity aggregates', () => {
  it('discards short voice/stream/game sessions and cleans up', async () => {
    for (const tracker of ['voice', 'stream', 'game'] as const) {
      const { repository, records } = setup();
      const value = session({ tracker, game: tracker === 'game' ? { gameKey: 'name:game', displayName: 'Game', applicationId: null } : null });
      await repository.startSession(value);
      await repository.settleSession(guildId, value.id, start + 59_000, true);
      expect(records.size).toBe(0);
    }
  });
  it('splits midnight, qualifies once and never double-counts a duplicate close', async () => {
    const { repository, row } = setup(); const value = session();
    await repository.startSession(value);
    await repository.settleSession(guildId, value.id, start + 7200_000, true);
    await repository.settleSession(guildId, value.id, start + 8000_000, true);
    expect(row('activityMembers', userId)?.voiceSeconds).toBe(7200);
    expect(row('activityDailyMembers', `2026-10-01_${userId}`)?.voiceSeconds).toBe(1800);
    expect(row('activityDailyMembers', `2026-10-02_${userId}`)?.voiceSeconds).toBe(5400);
    expect(row('activityMembers', userId)?.currentVoiceStreak).toBe(2);
  });
  it('qualifies only at daily threshold and preserves a checkpoint cursor', async () => {
    const { repository, row } = setup(); const value = session();
    await repository.startSession(value);
    await repository.settleSession(guildId, value.id, start + 299000, false);
    expect(row('activityMembers', userId)?.currentVoiceStreak).toBe(0);
    await repository.settleSession(guildId, value.id, start + 300000, false);
    await repository.settleSession(guildId, value.id, start + 300000, false);
    await repository.settleSession(guildId, value.id, start + 600000, true);
    expect(row('activityMembers', userId)?.voiceSeconds).toBe(600);
    expect(row('activityMembers', userId)?.currentVoiceStreak).toBe(1);
  });
  it('keeps stream time separate while normal voice includes streaming', async () => {
    const { repository, row } = setup();
    for (const tracker of ['voice', 'stream']) { const value = session({ tracker }); await repository.startSession(value); await repository.settleSession(guildId, value.id, start + (tracker === 'voice' ? 7200000 : 1800000), true); }
    expect(row('activityMembers', userId)?.voiceSeconds).toBe(7200);
    expect(row('activityMembers', userId)?.streamSeconds).toBe(1800);
  });
  it('maintains distinct game players and stable canonical spelling', async () => {
    const { repository, row } = setup(); const game = { gameKey: 'name:game', displayName: 'Game', applicationId: null };
    for (let index = 0; index < 3; index++) {
      const value = session({ tracker: 'game', userId: index === 2 ? '42345678901234567' : userId, game: { ...game, displayName: index === 0 ? 'Game' : 'GAME' } });
      await repository.startSession(value); await repository.settleSession(guildId, value.id, start + 60000, false); await repository.settleSession(guildId, value.id, start + 120000, true);
    }
    expect(row('activityGames', activityKey(game.gameKey))).toMatchObject({ totalSeconds: 360, sessionCount: 3, uniquePlayers: 2, displayName: 'Game' });
  });
  it('message batches retry without double increments, including a user spanning two days', async () => {
    const { repository, row } = setup();
    const values = [{ userId, date: '2026-10-01', count: 3, observedAt: start }, { userId, date: '2026-10-02', count: 4, observedAt: start + 7200000 }];
    await repository.flushMessages(guildId, 'batch-one', values); await repository.flushMessages(guildId, 'batch-one', values);
    expect(row('activityMembers', userId)?.messages).toBe(7);
    expect(row('activityDailyMembers', `2026-10-01_${userId}`)?.messages).toBe(3);
  });
  it('rejects invalid guild paths and cross-guild sessions', async () => {
    const { repository } = setup();
    expect(() => repository.root('../other')).toThrow();
    const value = session(); await repository.startSession(value);
    await expect(repository.settleSession('52345678901234567', value.id, start + 60000, true)).resolves.toBeNull();
  });
});

describe('real period leaderboard semantics', () => {
  it('missing-index fallback filters other users/games on the server', async () => {
    const { repository } = setup(true);
    const service = new ActivityLeaderboardService(repository, () => start);
    await repository.saveSettings(guildId, activitySettingsSchema.parse({ enabled: true }), userId);
    await repository.flushMessages(guildId, 'mixed', [{ userId, date: '2026-10-01', count: 2, observedAt: start }, { userId: '42345678901234567', date: '2026-10-01', count: 99, observedAt: start }]);
    expect((await service.member(guildId, userId, 'today')).messages).toBe(2);
    for (const [member, name] of [[userId, 'one'], ['42345678901234567', 'two']]) {
      const value = session({ tracker: 'game', userId: member, game: { gameKey: `name:${name}`, displayName: name, applicationId: null } });
      await repository.startSession(value); await repository.settleSession(guildId, value.id, start + 60000, true);
    }
    expect((await service.gamePlayers(guildId, 'name:one', 'today')).map((row) => row.userId)).toEqual([userId]);
    expect((await service.gamePlayers(guildId, 'name:one', 'all')).map((row) => row.userId)).toEqual([userId]);
    expect((await service.memberGames(guildId, userId, 'today')).map((row) => row.gameKey)).toEqual(['name:one']);
    expect((await service.memberGames(guildId, userId, 'all')).map((row) => row.gameKey)).toEqual(['name:one']);
  });
  async function seeded() {
    const store = setup();
    await store.repository.saveSettings(guildId, activitySettingsSchema.parse({ enabled: true }), userId);
    for (const [date, count] of [['2026-10-01', 2], ['2026-09-30', 3], ['2026-09-25', 5], ['2026-09-02', 7], ['2026-09-01', 11]] as const) await store.repository.flushMessages(guildId, date, [{ userId, date, count, observedAt: start }]);
    return { ...store, service: new ActivityLeaderboardService(store.repository, () => start) };
  }
  it.each([['today', 2], ['7d', 10], ['30d', 17], ['all', 28]] as const)('uses %s aggregates', async (period, expected) => {
    const { service } = await seeded();
    expect((await service.memberLeaderboard(guildId, 'messages', period))[0]?.value).toBe(expected);
    expect((await service.member(guildId, userId, period)).messages).toBe(expected);
  });
  it('returns exact message totals for every period from one monthly range and an all-time sum', async () => {
    const { service, records } = await seeded();
    records.set(`guilds/${guildId}/activityDailyMembers/2026-10-02_${userId}`, { userId, date: '2026-10-02', messages: 999 });
    records.set(`guilds/52345678901234567/activityMembers/${userId}`, { userId, messages: 999 });
    expect(await service.messageTotals(guildId)).toEqual({ today: 2, '7d': 10, '30d': 17, all: 28 });
  });
  it('does not download the all-time member collection or truncate totals above the row limit', async () => {
    const { service, records } = await seeded();
    for (let index = 0; index < 20001; index++) {
      const id = String(40000000000000000n + BigInt(index));
      records.set(`guilds/${guildId}/activityMembers/${id}`, { userId: id, messages: 1 });
    }
    expect((await service.messageTotals(guildId)).all).toBe(20029);
  });
  it('has stable ties and bounded top N', async () => {
    const { repository, service } = await seeded();
    await repository.flushMessages(guildId, 'tie', [{ userId: '12345678901234568', date: '2026-10-01', count: 2, observedAt: start }]);
    expect((await service.memberLeaderboard(guildId, 'messages', 'today', 1))[0]?.userId).toBe(userId);
    await expect(service.memberLeaderboard(guildId, 'messages', 'all', 100)).rejects.toThrow('limit');
  });
  it('counts unique game players once across days and returns per-game/member leaderboards', async () => {
    const { repository, service } = await seeded();
    const game = { gameKey: 'name:test', displayName: 'Test', applicationId: null };
    for (const offset of [0, -86400000]) {
      const value = session({ tracker: 'game', game, startedAt: start + offset, cursorAt: start + offset, lastObservedAt: start + offset });
      await repository.startSession(value); await repository.settleSession(guildId, value.id, start + offset + 60000, true);
    }
    expect((await service.games(guildId, '7d'))[0]).toMatchObject({ totalSeconds: 120, uniquePlayers: 1 });
    expect((await service.gamePlayers(guildId, game.gameKey, '7d'))[0]?.totalSeconds).toBe(120);
    expect((await service.memberGames(guildId, userId, 'all'))[0]?.totalSeconds).toBe(120);
  });
  it('expires current streaks and keeps longest, filters old configuration epochs', async () => {
    const { records, service } = await seeded();
    records.set(`guilds/${guildId}/activityMembers/${userId}`, { userId, currentVoiceStreak: 4, longestVoiceStreak: 8, lastQualifiedVoiceDate: '2026-09-29', streakEpoch: 'Europe/Kyiv:300:true' });
    expect(await service.memberLeaderboard(guildId, 'currentVoiceStreak', 'all')).toEqual([]);
    expect((await service.memberLeaderboard(guildId, 'longestVoiceStreak', 'all'))[0]?.value).toBe(8);
  });
  it('searches observed names and usernames with directory pagination', async () => {
    const { repository, service } = await seeded();
    await repository.saveProfile(guildId, { userId, displayName: 'Артом', username: 'artom', avatarUrl: 'https://cdn.discordapp.com/a.png', searchName: 'артом', updatedAt: start });
    expect((await service.directory(guildId, 'art')).profiles[0]?.userId).toBe(userId);
    expect((await service.directory(guildId, 'Арт')).profiles[0]?.userId).toBe(userId);
  });
});

describe('Activity analytics refinements', () => {
  function contributions(missingIndexes = false) {
    const store = setup(missingIndexes);
    const gameKey = 'name:dota 2'; const hash = activityKey(gameKey); const other = '32345678901234567';
    const common = { gameKey, displayName: 'Dota 2', applicationId: null };
    let total = 0;
    for (const [date, seconds] of [['2026-10-01', 60], ['2026-09-30', 120], ['2026-09-25', 180], ['2026-09-02', 240], ['2026-09-01', 300]] as const) {
      total += seconds;
      for (const [id, multiplier] of [[userId, 1], [other, 2]] as const) store.records.set('guilds/' + guildId + '/activityDailyGameMembers/' + date + '_' + hash + '_' + id, { ...common, date, userId: id, totalSeconds: seconds * multiplier, sessionCount: 1, lastPlayedAt: start });
      store.records.set('guilds/' + guildId + '/activityDailyGames/' + date + '_' + hash, { ...common, date, totalSeconds: seconds * 3, sessionCount: 2, lastPlayedAt: start });
    }
    store.records.set('guilds/' + guildId + '/activityGames/' + hash, { ...common, totalSeconds: total * 3, uniquePlayers: 2, sessionCount: 10, lastPlayedAt: start });
    for (const [id, multiplier] of [[userId, 1], [other, 2]] as const) store.records.set('guilds/' + guildId + '/activityGameMembers/' + hash + '_' + id, { ...common, userId: id, totalSeconds: total * multiplier, sessionCount: 5, lastPlayedAt: start });
    return { ...store, gameKey, hash, other, service: new ActivityLeaderboardService(store.repository, () => start) };
  }
  it.each([['today', 180, 1], ['7d', 1080, 7], ['30d', 1800, 30], ['all', 2700, 0]] as const)('loads %s contributors using automatic indexes and only matching game/date rows', async (period, total, days) => {
    const { service, records, queries, gameKey, other, hash } = contributions(true);
    const outside = { gameKey, date: '2026-10-02', userId, totalSeconds: 999999 };
    records.set('guilds/' + guildId + '/activityDailyGames/2026-10-02_' + hash, outside);
    records.set('guilds/' + guildId + '/activityDailyGameMembers/2026-10-02_' + hash + '_' + userId, outside);
    for (let index = 0; index < 20001; index++) {
      const unrelated = { gameKey: 'name:other ' + index, date: '2026-10-01', userId, totalSeconds: 999999 };
      records.set('guilds/' + guildId + '/activityDailyGameMembers/unrelated_' + index, unrelated);
      records.set('guilds/' + guildId + '/activityGameMembers/unrelated_' + index, unrelated);
    }
    records.set('guilds/52345678901234567/activityGameMembers/' + hash + '_' + userId, { gameKey, userId, totalSeconds: 999999 });
    const summary = await service.game(guildId, gameKey, period);
    const players = await service.gamePlayers(guildId, gameKey, period);
    expect(summary?.totalSeconds).toBe(total);
    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({ userId: other, totalSeconds: total * 2 / 3 });
    expect(players.reduce((sum, row) => sum + row.contributionPercent, 0)).toBeCloseTo(100);
    expect(queries).toHaveLength(period === 'all' ? 1 : 2);
    for (const query of queries) {
      expect(query.collection).toMatch('guilds/' + guildId + '/');
      expect(query.filters).toContainEqual({ field: 'gameKey', operator: '==', value: gameKey });
      if (days) {
        expect(query.filters).toContainEqual({ field: 'date', operator: 'in', value: expect.arrayContaining(['2026-10-01']) });
        expect(query.filters.find((filter) => filter.field === 'date')?.value).toHaveLength(days);
      }
    }
  });
  it.each(['today', 'all'] as const)('fails explicitly instead of truncating %s contributors above the row cap', async (period) => {
    const { records, service, gameKey } = contributions(true);
    const collection = period === 'all' ? 'activityGameMembers' : 'activityDailyGameMembers';
    for (let index = 0; index < 20001; index++) {
      const id = String(60000000000000000n + BigInt(index));
      records.set('guilds/' + guildId + '/' + collection + '/' + id, { gameKey, date: '2026-10-01', userId: id, totalSeconds: 1 });
    }
    await expect(service.gamePlayers(guildId, gameKey, period)).rejects.toThrow('забагато даних');
  });
  it.each([['today', 180], ['7d', 1080], ['30d', 1800], ['all', 2700]] as const)('uses matching %s numerator and denominator', async (period, total) => {
    const { service, gameKey, other } = contributions();
    const summary = await service.game(guildId, gameKey, period);
    const rows = await service.gamePlayers(guildId, gameKey, period);
    expect(summary).toMatchObject({ totalSeconds: total, uniquePlayers: 2 });
    expect(rows.map((row) => row.userId)).toEqual([other, userId]);
    expect(rows[0]!.totalSeconds).toBe(total * 2 / 3);
    expect(rows[0]!.contributionPercent).toBeCloseTo(200 / 3);
    expect(rows[1]!.contributionPercent).toBeCloseTo(100 / 3);
    expect(rows.reduce((sum, row) => sum + row.contributionPercent, 0)).toBeCloseTo(100);
    expect((await service.gamePlayers(guildId, gameKey, period, 1))[0]!.contributionPercent).toBeCloseTo(200 / 3);
  });
  it('keeps deterministic ties, bounded limits, and zero totals safe', async () => {
    const { service, records, gameKey, hash, other } = contributions();
    for (const id of [userId, other]) records.set('guilds/' + guildId + '/activityGameMembers/' + hash + '_' + id, { gameKey, userId: id, totalSeconds: 30 });
    records.set('guilds/' + guildId + '/activityGames/' + hash, { gameKey, totalSeconds: 0 });
    const rows = await service.gamePlayers(guildId, gameKey, 'all', 1);
    expect(rows).toMatchObject([{ userId: other, contributionPercent: 0 }]);
    await expect(service.gamePlayers(guildId, gameKey, 'all', 0)).rejects.toThrow('limit');
    await expect(service.gamePlayers(guildId, gameKey, 'all', 51)).rejects.toThrow('limit');
    await expect(service.game(guildId, gameKey, 'invalid' as 'all')).rejects.toThrow();
  });
  it('ignores reversibly across games, overview leaders, profile games and detail, without deleting history', async () => {
    const { repository, records, gameKey, hash } = contributions();
    const fresh = () => new ActivityLeaderboardService(repository, () => start);
    expect((await fresh().games(guildId, 'today'))[0]?.gameKey).toBe(gameKey);
    const original = structuredClone(records.get('guilds/' + guildId + '/activityGames/' + hash));
    await repository.setGameIgnored(guildId, gameKey, true, userId);
    for (const period of ['today', '7d', '30d', 'all'] as const) {
      expect(await fresh().games(guildId, period, 3)).toEqual([]);
      expect(await fresh().memberGames(guildId, userId, period)).toEqual([]);
      expect(await fresh().game(guildId, gameKey, period)).toBeNull();
      expect(await fresh().gamePlayers(guildId, gameKey, period)).toEqual([]);
    }
    expect((await fresh().observedGames(guildId)).games[0]?.gameKey).toBe(gameKey);
    expect(records.get('guilds/' + guildId + '/activityGames/' + hash)).toEqual(original);
    await repository.saveSettings(guildId, activitySettingsSchema.parse({ enabled: true }), userId);
    expect((await repository.getSettings(guildId)).games.ignoredGameKeys).toEqual([gameKey]);
    await repository.setGameIgnored(guildId, gameKey, false, userId);
    expect((await fresh().games(guildId, 'all'))[0]).toMatchObject(original!);
    expect((await fresh().gamePlayers(guildId, gameKey, 'all')).length).toBe(2);
  });
  it('rejects cross-guild exclusion keys and scopes detail queries', async () => {
    const { repository, service, gameKey } = contributions();
    const otherGuild = '52345678901234567';
    await expect(repository.setGameIgnored(otherGuild, gameKey, true, userId)).rejects.toThrow('цьому серверу');
    expect(await service.game(otherGuild, gameKey, 'all')).toBeNull();
    expect(await service.gamePlayers(otherGuild, gameKey, '7d')).toEqual([]);
  });
  it('counts distinct active members from messages OR voice OR screen share and separates domain summaries', async () => {
    const { records, service } = contributions();
    for (const [id, values] of [[userId, { messages: 4 }], ['32345678901234567', { voiceSeconds: 60 }], ['42345678901234567', { streamSeconds: 30 }], ['52345678901234567', {}]] as const) records.set('guilds/' + guildId + '/activityDailyMembers/2026-10-01_' + id, { userId: id, date: '2026-10-01', ...values });
    expect(await service.overview(guildId, 'today')).toEqual({ messages: 4, voiceSeconds: 60, streamSeconds: 30, activeMembers: 3 });
    expect(await service.voiceSummary(guildId, 'today')).toEqual({ voiceSeconds: 60, streamSeconds: 30, participants: 2 });
    expect(await service.messageSummary(guildId, 'today')).toEqual({ messages: 4, authors: 1, average: 4 });
  });
  it('normalizes member activity shares within the same period', async () => {
    const { service } = contributions();
    expect((await service.memberGames(guildId, userId, '7d'))[0]).toMatchObject({ totalSeconds: 360, activityPercent: 100 });
  });
});

describe('Activity analytics query budgets', () => {
  it('uses bounded in-query batches and one metadata batch for 50 games, with no per-game queries', async () => {
    const { repository, records, queries, batches } = setup();
    for (let index = 0; index < 50; index++) {
      const gameKey = 'name:game ' + index; const hash = activityKey(gameKey);
      const common = { gameKey, displayName: 'Game ' + index, totalSeconds: 60, date: '2026-10-01', sessionCount: 1 };
      records.set('guilds/' + guildId + '/activityGames/' + hash, common);
      records.set('guilds/' + guildId + '/activityDailyGames/2026-10-01_' + hash, common);
      records.set('guilds/' + guildId + '/activityDailyGameMembers/2026-10-01_' + hash + '_' + userId, { ...common, userId });
    }
    const service = new ActivityLeaderboardService(repository, () => start);
    const games = await service.games(guildId, 'today', 50);
    expect(games).toHaveLength(50);
    expect(games.every((game) => game.uniquePlayers === 1)).toBe(true);
    expect(queries.filter((query) => query.collection.endsWith('/activityDailyGames'))).toHaveLength(1);
    expect(queries.filter((query) => query.collection.endsWith('/activityDailyGameMembers'))).toHaveLength(2);
    expect(batches).toEqual([50]);
  });
  it('reuses contribution daily reads and paginates the observed manager', async () => {
    const { repository, records, queries } = setup();
    const gameKey = 'name:game 0'; const hash = activityKey(gameKey);
    for (let index = 0; index < 60; index++) records.set('guilds/' + guildId + '/activityGames/' + activityKey('name:game ' + index), { gameKey: 'name:game ' + index, displayName: 'Game ' + index, totalSeconds: 60 });
    const common = { gameKey, date: '2026-10-01', totalSeconds: 60, userId };
    records.set('guilds/' + guildId + '/activityDailyGames/2026-10-01_' + hash, common);
    records.set('guilds/' + guildId + '/activityDailyGameMembers/2026-10-01_' + hash + '_' + userId, common);
    const service = new ActivityLeaderboardService(repository, () => start);
    await service.game(guildId, gameKey, 'today'); await service.gamePlayers(guildId, gameKey, 'today');
    expect(queries).toHaveLength(2);
    const first = await service.observedGames(guildId); const second = await service.observedGames(guildId, first.next!);
    expect(first.games).toHaveLength(50); expect(second.games).toHaveLength(10); expect(second.next).toBeNull();
    expect(new Set([...first.games, ...second.games].map((game) => game.gameKey)).size).toBe(60);
    await expect(service.observedGames(guildId, '../other')).rejects.toThrow('cursor');
  });
});

it('keeps one guild-calendar anchor when a contribution request crosses midnight', async () => {
  const { repository, records } = setup(); const gameKey = 'name:midnight'; const hash = activityKey(gameKey);
  for (const date of ['2026-10-01', '2026-10-02']) {
    const row = { gameKey, date, totalSeconds: date.endsWith('01') ? 60 : 120, userId };
    records.set('guilds/' + guildId + '/activityDailyGames/' + date + '_' + hash, row);
    records.set('guilds/' + guildId + '/activityDailyGameMembers/' + date + '_' + hash + '_' + userId, row);
  }
  records.set('guilds/' + guildId + '/activityGames/' + hash, { gameKey, totalSeconds: 180 });
  let clock = start;
  const service = new ActivityLeaderboardService(repository, () => clock);
  expect((await service.game(guildId, gameKey, 'today'))!.totalSeconds).toBe(60);
  clock += 7200000;
  expect((await service.gamePlayers(guildId, gameKey, 'today'))[0]).toMatchObject({ totalSeconds: 60, contributionPercent: 100 });
});
