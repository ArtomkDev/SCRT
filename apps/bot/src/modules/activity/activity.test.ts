import { describe, expect, it, vi } from 'vitest';
import { ActivityType, GatewayIntentBits, type VoiceState } from 'discord.js';
import { activitySettingsSchema, type ActivitySession } from '@scrt/validation';
import { activityEligible } from './eligibility';
import { MessageActivityBuffer } from './message-buffer';
import { ActivitySessionService } from './session-service';
import { gameSessions, voiceSessions } from './trackers';
import { activityGatewayIntents } from './gateway';

const guildId = '12345678901234567';
const userId = '22345678901234567';
const channelId = '32345678901234567';
const settings = activitySettingsSchema.parse({ enabled: true });
const actor = { userId, bot: false, roleIds: ['42345678901234567'] };
const channel = { id: channelId, parentId: '52345678901234567', categoryId: '62345678901234567', afk: false };
describe('centralized eligibility', () => {
  it('accepts human messages and eligible thread messages', () => expect(activityEligible(settings, 'messages', actor, channel)).toBe(true));
  it('rejects DMs, bots, disabled trackers and AFK', () => {
    expect(activityEligible(settings, 'messages', actor, null)).toBe(false);
    expect(activityEligible(settings, 'messages', { ...actor, bot: true }, channel)).toBe(false);
    expect(activityEligible(activitySettingsSchema.parse({}), 'messages', actor, channel)).toBe(false);
    expect(activityEligible(settings, 'voice', actor, { ...channel, afk: true })).toBe(false);
  });
  it.each([['channelIds', channelId], ['channelIds', channel.parentId], ['categoryIds', channel.categoryId], ['roleIds', actor.roleIds[0]], ['userIds', userId]])('rejects %s exclusions', (field, id) => {
    const excluded = activitySettingsSchema.parse({ enabled: true, exclusions: { [field]: [id] } });
    expect(activityEligible(excluded, 'voice', actor, channel)).toBe(false);
  });
  it('fails closed when excluded role membership is unknown', () => {
    const excluded = activitySettingsSchema.parse({ enabled: true, exclusions: { roleIds: actor.roleIds } });
    expect(activityEligible(excluded, 'games', { ...actor, roleIds: null }, null)).toBe(false);
  });
});
describe('message buffering', () => {
  it('counts messages without per-event writes and clears committed batches', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const buffer = new MessageActivityBuffer(commit);
    buffer.add(guildId, userId, '2026-10-01', 100);
    buffer.add(guildId, userId, '2026-10-01', 200);
    expect(commit).not.toHaveBeenCalled();
    await buffer.flush();
    expect(commit.mock.calls[0]?.[2]).toEqual([{ userId, date: '2026-10-01', count: 2, observedAt: 200 }]);
    expect(buffer.size).toBe(0);
  });
  it('retains failed batches and retry tokens, separates arrivals during flush', async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const buffer = new MessageActivityBuffer(commit);
    buffer.add(guildId, userId, '2026-10-01', 100);
    await expect(buffer.flush()).rejects.toThrow(guildId);
    const token = commit.mock.calls[0]?.[1];
    buffer.add(guildId, userId, '2026-10-01', 200);
    await buffer.flush();
    expect(commit.mock.calls[1]?.[1]).toBe(token);
    expect(commit).toHaveBeenCalledTimes(3);
    expect(buffer.size).toBe(0);
  });
  it('bounds pending users and coalesces overlapping flushes', async () => {
    let release!: () => void;
    const commit = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const buffer = new MessageActivityBuffer(commit, 1);
    buffer.add(guildId, userId, '2026-10-01', 100);
    expect(() => buffer.add(guildId, '72345678901234567', '2026-10-01', 100)).toThrow('full');
    const a = buffer.flush(); const b = buffer.flush();
    expect(a).toBe(b); release(); await a;
  });
  it('flushes other guilds while retaining failed snapshots and their order for retry', async () => {
    const otherGuild = '92345678901234567';
    const commit = vi.fn<(id: string, token: string) => Promise<void>>(async (id) => { if (id === guildId) throw new Error('unavailable'); });
    const buffer = new MessageActivityBuffer(commit);
    for (let index = 0; index < 81; index++) buffer.add(guildId, String(BigInt(userId) + BigInt(index)), '2026-10-01', 100);
    buffer.add(otherGuild, userId, '2026-10-01', 100);
    await expect(buffer.flush()).rejects.toThrow(guildId);
    expect(commit.mock.calls.map(([id]) => id)).toEqual([guildId, otherGuild]);
    expect(buffer.size).toBe(81);
    const failedToken = commit.mock.calls[0]?.[1];
    buffer.add(otherGuild, userId, '2026-10-01', 200);
    commit.mockImplementation(async () => undefined);
    await buffer.flush();
    expect(commit.mock.calls[2]?.[1]).toBe(failedToken);
    expect(commit.mock.calls.map(([id]) => id)).toEqual([guildId, otherGuild, guildId, guildId, otherGuild]);
    expect(buffer.size).toBe(0);
  });
});
describe('voice, stream and Playing transitions', () => {
  it('tracks voice and stream independently, keeps mute/deafen eligible', () => {
    const state = { channelId, streaming: true, selfMute: true, selfDeaf: true } as VoiceState;
    expect(voiceSessions(state, settings, actor, channel).map((session) => session.tracker)).toEqual(['voice', 'stream']);
    expect(voiceSessions({ channelId, streaming: false }, settings, actor, channel).map((session) => session.tracker)).toEqual(['voice']);
    expect(voiceSessions(state, settings, actor, { ...channel, afk: true })).toEqual([]);
  });
  it('supports multiple games, deduplicates identity, ignores all other activity types', () => {
    const presence = { status: 'online' as const, activities: [
      { type: ActivityType.Playing, name: 'Game A', applicationId: '82345678901234567' },
      { type: ActivityType.Playing, name: 'Game B', applicationId: null },
      ...[ActivityType.Listening, ActivityType.Custom, ActivityType.Streaming, ActivityType.Watching, ActivityType.Competing].map((type) => ({ type, name: 'Other', applicationId: null })),
    ] };
    expect(gameSessions(presence, settings, actor, true)).toHaveLength(2);
    expect(gameSessions(presence, settings, actor, false)).toEqual([]);
    expect(gameSessions({ ...presence, status: 'offline' }, settings, actor, true)).toEqual([]);
  });
  it('never requests MessageContent or adds members by default', () => {
    expect(activityGatewayIntents(true, false)).toContain(GatewayIntentBits.GuildPresences);
    expect(activityGatewayIntents(false, false)).not.toContain(GatewayIntentBits.GuildPresences);
    expect(activityGatewayIntents(true, false)).not.toContain(GatewayIntentBits.MessageContent);
    expect(activityGatewayIntents(true, false)).not.toContain(GatewayIntentBits.GuildMembers);
  });
});
describe('persistent session lifecycle', () => {
  function store() {
    const persisted = new Map<string, ActivitySession>();
    const startSession = vi.fn(async (session: ActivitySession) => { persisted.set(session.id, { ...session }); });
    const settleSession = vi.fn(async (_guild: string, id: string, end: number, close: boolean) => { const session = persisted.get(id); if (!session) return null; if (close) { persisted.delete(id); return null; } const next = { ...session, cursorAt: end, lastObservedAt: end }; persisted.set(id, next); return next; });
    return { persisted, startSession, settleSession, listSessions: vi.fn(async () => [...persisted.values()]) };
  }
  const desired = [{ tracker: 'voice' as const, channelId, game: null }];
  it('join starts, eligible move stays continuous, leave closes once', async () => {
    const repository = store(); const service = new ActivitySessionService(repository);
    await service.reconcile(guildId, userId, desired, settings, 1000);
    await service.reconcile(guildId, userId, [{ ...desired[0]!, channelId: '92345678901234567' }], settings, 2000);
    expect(repository.startSession).toHaveBeenCalledTimes(1);
    await service.reconcile(guildId, userId, [], settings, 121000);
    await service.reconcile(guildId, userId, [], settings, 122000);
    expect(repository.settleSession).toHaveBeenCalledTimes(1);
    expect(repository.settleSession.mock.calls[0]?.[2]).toBe(121000);
  });
  it('AFK/excluded closes and eligible resumes a fresh session', async () => {
    const repository = store(); const service = new ActivitySessionService(repository);
    await service.reconcile(guildId, userId, desired, settings, 1000);
    await service.reconcile(guildId, userId, [], settings, 121000);
    await service.reconcile(guildId, userId, desired, settings, 181000);
    expect(repository.startSession).toHaveBeenCalledTimes(2);
  });
  it('unchanged games keep starts and vanished games close individually', async () => {
    const repository = store(); const service = new ActivitySessionService(repository);
    const games = ['A', 'B'].map((name) => ({ tracker: 'game' as const, channelId: null, game: { gameKey: `name:${name}`, displayName: name, applicationId: null } }));
    await service.reconcile(guildId, userId, games, settings, 1000);
    await service.reconcile(guildId, userId, games, settings, 2000);
    expect(repository.startSession).toHaveBeenCalledTimes(2);
    await service.reconcile(guildId, userId, [games[0]!], settings, 61000);
    expect(service.sessions()).toHaveLength(1);
    expect(service.sessions()[0]?.startedAt).toBe(1000);
  });
  it('retries a failed close at its original boundary', async () => {
    const repository = store(); const service = new ActivitySessionService(repository);
    await service.reconcile(guildId, userId, desired, settings, 1000);
    repository.settleSession.mockRejectedValueOnce(new Error('offline'));
    await expect(service.reconcile(guildId, userId, [], settings, 61000)).rejects.toThrow('offline');
    await service.reconcile(guildId, userId, [], settings, 361000);
    expect(repository.settleSession.mock.calls.map((call) => call[2])).toEqual([61000, 61000]);
  });
  it('restart closes stale records at the durable observation, then starts fresh', async () => {
    const repository = store(); const first = new ActivitySessionService(repository);
    await first.reconcile(guildId, userId, desired, settings, 1000);
    await first.checkpoint(guildId, 301000);
    const recovered = new ActivitySessionService(repository);
    await recovered.recover(guildId);
    expect(repository.settleSession.mock.calls.at(-1)?.[2]).toBe(301000);
    expect(repository.persisted.size).toBe(0);
    await recovered.reconcile(guildId, userId, desired, settings, 901000);
    expect(recovered.sessions()[0]?.startedAt).toBe(901000);
  });
  it('serializes concurrent events for the same member', async () => {
    const repository = store(); const service = new ActivitySessionService(repository);
    await Promise.all([service.exclusive(guildId, userId, () => service.reconcile(guildId, userId, desired, settings, 1000)), service.exclusive(guildId, userId, () => service.reconcile(guildId, userId, [], settings, 61000))]);
    expect(service.sessions()).toEqual([]);
    expect(repository.startSession).toHaveBeenCalledTimes(1);
  });
});
