import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityType, type Client, type Guild, type GuildMember, type Message, type Presence, type VoiceState } from 'discord.js';
import { ActivityRepository, type MessageIncrement } from '@scrt/database';
import { activitySettingsSchema, type ActivitySession, type ActivitySettings } from '@scrt/validation';
import { ActivityModule } from './activity.module';
import type { ActivityArtworkResolver } from '@scrt/artwork';

const guildId = '12345678901234567'; const userId = '22345678901234567'; const channelId = '32345678901234567';
const modules: ActivityModule[] = [];
function fixture(presence = true, artwork?: ActivityArtworkResolver) {
  const settings = activitySettingsSchema.parse({ enabled: true });
  const persisted = new Map<string, ActivitySession>();
  let settingsChanged!: (value: ActivitySettings) => void;
  const repo = {
    getSettings: vi.fn(async () => settings),
    watchSettings: vi.fn((_guild: string, next: (value: ActivitySettings) => void) => { settingsChanged = next; return vi.fn(); }),
    startSession: vi.fn(async (session: ActivitySession) => { persisted.set(session.id, structuredClone(session)); }),
    settleSession: vi.fn(async (_guild: string, id: string, end: number, close: boolean) => {
      const session = persisted.get(id); if (!session) return null;
      if (close) { persisted.delete(id); return null; }
      const next = { ...session, cursorAt: end, lastObservedAt: end }; persisted.set(id, next); return next;
    }),
    listSessions: vi.fn(async (id: string) => [...persisted.values()].filter((session) => session.guildId === id)), flushMessages: vi.fn<(guildId: string, token: string, values: readonly MessageIncrement[]) => Promise<void>>(async () => undefined), saveProfile: vi.fn(async () => undefined), saveHealth: vi.fn(async () => undefined), cleanupReceipts: vi.fn<(guildId: string) => Promise<void>>(async () => undefined),
  };
  const member = { id: userId, user: { bot: false, username: 'Human' }, roles: { cache: new Map() }, displayName: 'Human', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } as unknown as GuildMember;
  const guild = { id: guildId, afkChannelId: '42345678901234567', channels: { cache: new Map([[channelId, { id: channelId, parentId: null, isThread: () => false }], ['42345678901234567', { id: '42345678901234567', parentId: null, isThread: () => false }]]) }, members: { cache: new Map([[userId, member]]), fetch: vi.fn(async () => member) }, voiceStates: { cache: new Map() }, presences: { cache: new Map() } } as unknown as Guild;
  Object.assign(member, { guild });
  const client = { guilds: { cache: new Map([[guildId, guild]]) } } as unknown as Client;
  const module = new ActivityModule(client, repo as unknown as ActivityRepository, presence, artwork);
  module.setConnected(true); modules.push(module);
  return { module, repo, guild, member, persisted, client, settingsChanged: (value: ActivitySettings) => settingsChanged(value) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { for (const module of modules.splice(0)) await module.shutdown(); vi.useRealTimers(); });

describe('Activity event orchestration', () => {
  it('persists game sessions without waiting for an unresolved artwork provider', async () => {
    const resolve = vi.fn<ActivityArtworkResolver['resolve']>(() => new Promise(() => undefined));
    const { module, guild, member, persisted, repo } = fixture(true, { resolve } as unknown as ActivityArtworkResolver);
    await module.recover(guild);
    const presence = { guild, userId, member, status: 'online', activities: [{ type: ActivityType.Playing, name: ' Dota 2 ', applicationId: null, assets: { smallImageURL: () => 'https://cdn.discordapp.com/app-assets/123/456.png', largeImageURL: () => null } }] } as unknown as Presence;
    await module.onPresence(presence);
    expect(persisted.size).toBe(1); expect(repo.startSession).toHaveBeenCalledOnce(); expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0]?.[2]).toEqual({ discord: { iconUrl: 'https://cdn.discordapp.com/app-assets/123/456.png', heroUrl: null } });
    await module.onPresence(presence); expect(resolve).toHaveBeenCalledOnce();
  });
  it('coalesces profile writes during message bursts', async () => {
    const { module, guild, member, repo } = fixture(); await module.recover(guild);
    await Promise.all(Array.from({ length: 100 }, (_, index) => module.onMessage({ id: `burst-${index}`, guild, author: member.user, member, channelId, webhookId: null, createdTimestamp: Date.now() } as unknown as Message)));
    expect(repo.saveProfile).toHaveBeenCalledTimes(1);
    await module.shutdown();
    expect(repo.flushMessages.mock.calls[0]?.[2][0]?.count).toBe(100);
  });
  it('counts one guild message without accessing content and ignores bot/DM/webhook', async () => {
    const { module, guild, repo } = fixture(); await module.recover(guild);
    const message = { id: 'message-one', guild, author: { id: userId, bot: false }, member: null, channelId, webhookId: null, createdTimestamp: Date.now() };
    Object.defineProperty(message, 'content', { get: () => { throw new Error('Message content must never be read'); } });
    await module.onMessage(message as unknown as Message);
    await module.onMessage(message as unknown as Message);
    await module.onMessage({ ...message, id: 'bot', author: { id: userId, bot: true } } as unknown as Message);
    await module.onMessage({ ...message, id: 'dm', guild: null } as unknown as Message);
    await module.onMessage({ ...message, id: 'webhook', webhookId: 'webhook' } as unknown as Message);
    expect(repo.flushMessages).not.toHaveBeenCalled();
    await module.shutdown();
    expect(repo.flushMessages).toHaveBeenCalledTimes(1);
    expect(repo.flushMessages.mock.calls[0]).toBeDefined();
    expect(module.messages.size).toBe(0);
  });
  it('creates/ends voice and stream together and detects stream-only changes', async () => {
    const { module, guild, member, repo, persisted } = fixture(); await module.recover(guild);
    const voice = { guild, id: userId, member, channelId, streaming: false } as unknown as VoiceState;
    guild.voiceStates.cache.set(userId, voice); await module.onVoiceState(voice, voice);
    expect(persisted.size).toBe(1);
    const stream = { ...voice, streaming: true } as VoiceState;
    guild.voiceStates.cache.set(userId, stream); await module.onVoiceState(voice, stream);
    expect(persisted.size).toBe(2);
    guild.voiceStates.cache.set(userId, voice); await module.onVoiceState(stream, voice);
    expect(persisted.size).toBe(1);
    const leave = { ...voice, channelId: null } as VoiceState;
    guild.voiceStates.cache.delete(userId); await module.onVoiceState(voice, leave);
    expect(persisted.size).toBe(0); expect(repo.settleSession).toHaveBeenCalledTimes(2);
  });
  it('reconciles exclusions promptly and starts new sessions after re-enabling', async () => {
    const { module, guild, member, persisted, settingsChanged } = fixture(); await module.recover(guild);
    const voice = { guild, id: userId, member, channelId, streaming: true } as unknown as VoiceState;
    guild.voiceStates.cache.set(userId, voice); await module.onVoiceState(voice, voice);
    settingsChanged(activitySettingsSchema.parse({ enabled: true, exclusions: { channelIds: [channelId] } }));
    await vi.advanceTimersByTimeAsync(1);
    expect(persisted.size).toBe(0);
    settingsChanged(activitySettingsSchema.parse({ enabled: true })); await vi.advanceTimersByTimeAsync(1);
    expect(persisted.size).toBe(2);
  });
  it('keeps voice/messages alive while Presence is unavailable', async () => {
    const { module, guild, member, persisted } = fixture(false); await module.recover(guild);
    const presence = { guild, userId, member, status: 'online', activities: [{ type: ActivityType.Playing, name: 'Game', applicationId: null }] } as unknown as Presence;
    guild.presences.cache.set(userId, presence); await module.onPresence(presence);
    expect(persisted.size).toBe(0);
    const voice = { guild, id: userId, member, channelId, streaming: true } as unknown as VoiceState;
    guild.voiceStates.cache.set(userId, voice); await module.onVoiceState(voice, voice);
    expect(persisted.size).toBe(2);
  });
  it('restarts active voice/stream/game conservatively after disconnect', async () => {
    const { module, guild, member, persisted } = fixture(); await module.recover(guild);
    const presence = { guild, userId, member, status: 'online', activities: [{ type: ActivityType.Playing, name: 'Game', applicationId: null }] } as unknown as Presence;
    guild.presences.cache.set(userId, presence);
    const voice = { guild, id: userId, member, channelId, streaming: true } as unknown as VoiceState;
    guild.voiceStates.cache.set(userId, voice); await module.onVoiceState(voice, voice);
    expect(persisted.size).toBe(3);
    await module.disconnect(); expect(persisted.size).toBe(0);
    await vi.advanceTimersByTimeAsync(120000); module.setConnected(true); await module.recover(guild);
    expect(persisted.size).toBe(3);
    expect([...persisted.values()].every((session) => session.startedAt === Date.now())).toBe(true);
  });
});

describe('Guild recovery failure isolation', () => {
  it('completes recovery while profile enrichment is still pending', async () => {
    const { module, guild, member, repo } = fixture();
    guild.voiceStates.cache.set(userId, { guild, id: userId, member, channelId, streaming: false } as unknown as VoiceState);
    let release!: () => void;
    repo.saveProfile.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    let recovered = false;
    const recovery = module.recover(guild).then(() => { recovered = true; });
    await vi.advanceTimersByTimeAsync(1);
    try { expect(recovered).toBe(true); }
    finally { release(); await recovery; }
  });
  it('keeps observing settings after session recovery fails and retries when settings change', async () => {
    const { module, guild, member, repo, persisted, settingsChanged } = fixture();
    const voice = { guild, id: userId, member, channelId, streaming: false } as unknown as VoiceState;
    guild.voiceStates.cache.set(userId, voice);
    repo.startSession.mockRejectedValueOnce(new Error('session unavailable'));
    await expect(module.recover(guild)).rejects.toThrow('session unavailable');
    expect(repo.watchSettings).toHaveBeenCalledOnce();
    repo.getSettings.mockResolvedValue(activitySettingsSchema.parse({ enabled: false }));
    settingsChanged(activitySettingsSchema.parse({ enabled: false }));
    await vi.waitFor(() => expect(repo.saveHealth).toHaveBeenCalledWith(guildId, expect.objectContaining({ recovery: true })));
    expect(persisted.size).toBe(0);
    settingsChanged(activitySettingsSchema.parse({ enabled: true }));
    await vi.waitFor(() => expect(persisted.size).toBe(1));
  });
  it('keeps tracking and the settings listener alive when a profile write fails during recovery', async () => {
    const { module, guild, member, repo, persisted, settingsChanged } = fixture();
    const voice = { guild, id: userId, member, channelId, streaming: false } as unknown as VoiceState;
    guild.voiceStates.cache.set(userId, voice);
    repo.saveProfile.mockRejectedValueOnce(new Error('profile unavailable'));
    await module.recover(guild);
    expect(repo.watchSettings).toHaveBeenCalledOnce();
    expect(repo.saveHealth).toHaveBeenCalledWith(guildId, expect.objectContaining({ recovery: true }));
    const stream = { ...voice, streaming: true } as VoiceState;
    await module.onVoiceState(voice, stream);
    expect(persisted.size).toBe(2);
    settingsChanged(activitySettingsSchema.parse({ enabled: false }));
    await vi.waitFor(() => expect(persisted.size).toBe(0));
  });
  it('pauses an unavailable guild and waits for suspension before restarting visible sessions', async () => {
    const { module, guild, member, repo, persisted } = fixture();
    const voice = { guild, id: userId, member, channelId, streaming: false } as unknown as VoiceState;
    guild.voiceStates.cache.set(userId, voice);
    await module.recover(guild);
    const observedAt = Date.now();
    Object.assign(guild, { available: false });
    await vi.advanceTimersByTimeAsync(300000);
    expect(repo.settleSession).not.toHaveBeenCalled();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const settle = repo.settleSession.getMockImplementation()!;
    repo.settleSession.mockImplementationOnce(async (...args) => { await blocked; return settle(...args); });
    const suspension = module.suspendGuild(guildId);
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.settleSession).toHaveBeenCalledWith(guildId, expect.any(String), observedAt, true);
    Object.assign(guild, { available: true });
    const recovery = module.recover(guild);
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.startSession).toHaveBeenCalledOnce();
    release();
    await Promise.all([suspension, recovery]);
    expect(persisted.size).toBe(1);
    expect([...persisted.values()][0]?.startedAt).toBe(Date.now());
    expect(repo.startSession).toHaveBeenCalledTimes(2);
  });
  it('continues periodic recovery for other guilds when publishing one guild health fails', async () => {
    const { module, guild, client, repo } = fixture();
    const otherId = '92345678901234567';
    const other = { ...guild, id: otherId } as Guild;
    client.guilds.cache.set(otherId, other);
    await module.recover(guild);
    await module.recover(other);
    repo.cleanupReceipts.mockClear();
    repo.saveHealth.mockRejectedValueOnce(new Error('health unavailable'));
    await vi.advanceTimersByTimeAsync(300000);
    expect(repo.cleanupReceipts.mock.calls.map(([id]) => id)).toEqual([guildId, otherId]);
  });
});

describe('Observed application exclusions', () => {
  it('closes a live ignored session through the settings listener at reconciliation time and resumes on unignore', async () => {
    const { module, guild, member, repo, persisted, settingsChanged } = fixture();
    const presence = { guild, userId, member, status: 'online', activities: [{ type: ActivityType.Playing, name: 'Visual Studio Code', applicationId: null }] } as unknown as Presence;
    guild.presences.cache.set(userId, presence);
    await module.recover(guild);
    const session = [...persisted.values()][0]!;
    expect(session.game?.gameKey).toBe('name:visual studio code');
    vi.setSystemTime(Date.now() + 600000);
    const boundary = Date.now();
    settingsChanged(activitySettingsSchema.parse({ enabled: true, games: { ignoredGameKeys: ['name:visual studio code'] } }));
    await vi.waitFor(() => expect(persisted.size).toBe(0));
    expect(repo.settleSession).toHaveBeenCalledWith(guildId, session.id, boundary, true);
    await module.onPresence(presence);
    expect(persisted.size).toBe(0);
    const resumedAt = Date.now();
    settingsChanged(activitySettingsSchema.parse({ enabled: true }));
    await vi.waitFor(() => expect(persisted.size).toBe(1));
    expect([...persisted.values()][0]!.startedAt).toBe(resumedAt);
  });
});
