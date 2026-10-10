import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, Guild } from 'discord.js';
import type { GuildRepository, MediaRepository } from '@scrt/database';
import { mediaSettingsSchema } from '@scrt/validation';
import { MediaModule } from './media.module';

vi.mock('./playback-engine', () => ({
  playbackDependencies: () => ({ available: true, ffmpeg: true, opus: true, dave: true }),
  MediaPlaybackEngine: class {
    async connect() {} async play() {} async seek() {} pause() {} resume() {} volume() {} stop() {} destroy() {}
  },
}));

const guildId = '12345678901234567', userId = '22345678901234567';
const modules: MediaModule[] = [];
async function fixture() {
  const member = { id: userId, user: { bot: false }, roles: { cache: new Map() }, voice: { channel: null } };
  const guild = { id: guildId, ownerId: userId, available: true, members: { fetch: vi.fn(async () => member) }, voiceStates: { cache: new Map() } } as unknown as Guild;
  const client = { isReady: () => true, guilds: { cache: new Map([[guildId, guild]]) } } as unknown as Client;
  const repo = {
    lease: vi.fn<MediaRepository['lease']>(async () => true),
    getSession: vi.fn(async () => null), getSettings: vi.fn(async () => mediaSettingsSchema.parse({ enabled: true })),
    pruneHistory: vi.fn(async () => undefined),
  };
  const guilds = { accessMappings: async () => ({ roles: [], members: [] }) } as unknown as GuildRepository;
  const module = await MediaModule.create(client, repo as unknown as MediaRepository, guilds, { MEDIA_INTERNAL_HOST: '127.0.0.1', MEDIA_INTERNAL_PORT: 3100 });
  modules.push(module);
  const recover = vi.spyOn(module.commands.sessions, 'recover');
  const suspend = vi.spyOn(module.commands.sessions, 'suspendAudio');
  const actor = () => module.commands.sessions.actor(guildId, userId);
  return { module, repo, guild, client, recover, suspend, actor };
}
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'info').mockImplementation(() => undefined); vi.spyOn(console, 'warn').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(async () => { for (const module of modules.splice(0)) await module.shutdown(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Media worker lease recovery', () => {
  it('waits for the old worker lease and automatically becomes available after expiry', async () => {
    const f = await fixture(); f.repo.lease.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await f.module.recover(f.guild);
    await expect(f.actor()).rejects.toThrow('недоступний');
    expect(f.recover).not.toHaveBeenCalled(); expect(f.guild.members.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    await expect(f.actor()).rejects.toThrow('недоступний');
    await vi.advanceTimersByTimeAsync(30000);
    await expect(f.actor()).resolves.toMatchObject({ userId });
    expect(f.recover).toHaveBeenCalledOnce(); expect(f.repo.pruneHistory).toHaveBeenCalledOnce();
  });
  it('suspends audio on a failed renewal, then recovers without another Gateway event', async () => {
    const f = await fixture(); await f.module.recover(f.guild);
    f.repo.lease.mockRejectedValueOnce(new Error('Firestore temporarily unavailable'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(f.suspend).toHaveBeenCalledWith(guildId); await expect(f.actor()).rejects.toThrow('недоступний');
    await vi.advanceTimersByTimeAsync(30000);
    await expect(f.actor()).resolves.toMatchObject({ userId }); expect(f.recover).toHaveBeenCalledTimes(2);
  });
  it('recovers after an initial session recovery failure while refusing commands until ready', async () => {
    const f = await fixture(); f.recover.mockRejectedValueOnce(new Error('State read failed'));
    await f.module.recover(f.guild); await expect(f.actor()).rejects.toThrow('недоступний');
    await vi.advanceTimersByTimeAsync(30000);
    await expect(f.actor()).resolves.toMatchObject({ userId }); expect(f.recover).toHaveBeenCalledTimes(2);
  });
  it('bounds an unresolved lease request, coalesces duplicate events and clears its timeout', async () => {
    const f = await fixture(); f.repo.lease.mockImplementationOnce(() => new Promise(() => undefined));
    const first = f.module.recover(f.guild), second = f.module.recover(f.guild);
    expect(f.repo.lease).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8000); await Promise.all([first, second]);
    await expect(f.actor()).rejects.toThrow('недоступний'); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(22000);
    await expect(f.actor()).resolves.toMatchObject({ userId }); expect(vi.getTimerCount()).toBe(1);
  });
  it('does not regain ownership when a pending acquisition completes after guild removal', async () => {
    const f = await fixture(); let resolve!: (value: boolean) => void;
    f.repo.lease.mockImplementationOnce(() => new Promise<boolean>((next) => { resolve = next; }));
    const recovery = f.module.recover(f.guild), removal = f.module.stopGuild(guildId);
    resolve(true); await Promise.all([recovery, removal]);
    expect(f.recover).not.toHaveBeenCalled(); await expect(f.actor()).rejects.toThrow('недоступний');
    expect(f.repo.lease).toHaveBeenLastCalledWith(guildId, expect.any(String), true);
    const calls = f.repo.lease.mock.calls.length; await vi.advanceTimersByTimeAsync(60000); expect(f.repo.lease).toHaveBeenCalledTimes(calls);
  });
  it('waits for an in-flight acquisition on shutdown without restarting recovery', async () => {
    const f = await fixture(); let resolve!: (value: boolean) => void;
    f.repo.lease.mockImplementationOnce(() => new Promise<boolean>((next) => { resolve = next; }));
    const recovery = f.module.recover(f.guild), shutdown = f.module.shutdown();
    resolve(true); await Promise.all([recovery, shutdown]);
    expect(f.recover).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    await expect(f.actor()).rejects.toThrow('недоступний');
  });
  it('refuses commands after the last confirmed lease expires even before the timer runs', async () => {
    const f = await fixture(); await f.module.recover(f.guild);
    vi.setSystemTime(Date.now() + 60001);
    await expect(f.actor()).rejects.toThrow('недоступний');
  });
  it('keeps an occupied guild unavailable while another guild remains usable', async () => {
    const f = await fixture(); const otherId = '32345678901234567';
    const otherGuild = { ...f.guild, id: otherId } as Guild; f.client.guilds.cache.set(otherId, otherGuild);
    f.repo.lease.mockImplementation(async (id) => id === guildId);
    await Promise.all([f.module.recover(f.guild), f.module.recover(otherGuild)]);
    await expect(f.actor()).resolves.toMatchObject({ userId });
    await expect(f.module.commands.sessions.actor(otherId, userId)).rejects.toThrow('недоступний');
    await vi.advanceTimersByTimeAsync(30000); expect(f.recover).toHaveBeenCalledOnce();
  });
});

describe('Cold deployment recovery lease', () => {
 it('renews ownership during slow recovery without enabling commands early', async () => {
  const f = await fixture(); let finish!: () => void;
  f.recover.mockImplementationOnce(async (_guild, canRecover) => { await new Promise<void>((resolve) => { finish = resolve; }); expect(canRecover!()).toBe(true); });
  const recovery = f.module.recover(f.guild); await vi.advanceTimersByTimeAsync(0);
  await expect(f.actor()).rejects.toThrow('недоступний');
  await vi.advanceTimersByTimeAsync(90000);
  expect(f.repo.lease).toHaveBeenCalledTimes(4); expect(f.recover).toHaveBeenCalledOnce();
  await expect(f.actor()).rejects.toThrow('недоступний'); finish(); await recovery;
  await expect(f.actor()).resolves.toMatchObject({ userId }); expect(vi.getTimerCount()).toBe(1);
 });
 it.each(['denied', 'failed'])('keeps commands disabled if recovery heartbeat is %s', async (outcome) => {
  const f = await fixture(); let finish!: () => void; let allowed!: () => boolean;
  f.recover.mockImplementationOnce(async (_guild, canRecover) => { allowed = canRecover!; await new Promise<void>((resolve) => { finish = resolve; }); });
  const recovery = f.module.recover(f.guild); await vi.advanceTimersByTimeAsync(0);
  if (outcome === 'denied') f.repo.lease.mockResolvedValueOnce(false); else f.repo.lease.mockRejectedValueOnce(new Error('Firestore failure'));
  await vi.advanceTimersByTimeAsync(30000); expect(allowed()).toBe(false); finish(); await recovery;
  await expect(f.actor()).rejects.toThrow('недоступний'); expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(30000); await expect(f.actor()).resolves.toMatchObject({ userId });
 });
 it('does not extend a stopped guild lease while recovery is pending', async () => {
  const f = await fixture(); let finish!: () => void;
  f.recover.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { finish = resolve; }); });
  const recovery = f.module.recover(f.guild); await vi.advanceTimersByTimeAsync(0);
  const stopping = f.module.stopGuild(guildId); await vi.advanceTimersByTimeAsync(30000);
  expect(f.repo.lease).toHaveBeenCalledOnce(); finish(); await Promise.all([recovery, stopping]);
  expect(vi.getTimerCount()).toBe(0); await expect(f.actor()).rejects.toThrow('недоступний');
 });
});
