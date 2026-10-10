import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, type Client, type Guild, type VoiceState } from 'discord.js';
import type { MediaStore } from '@scrt/database';
import { mediaSettingsSchema, type MediaAction, type MediaCommand, type MediaSettings } from '@scrt/validation';
import { runtimeLogSnapshot, type MediaHistoryItem, type MediaSession, type MediaTrack } from '@scrt/shared';
import { MediaSourceError, MediaSourceRegistry, type MediaSourceProvider } from '@scrt/media';
import { MediaSessionService } from './command-service';
import type { EngineEvent, PlaybackEngine } from './playback-engine';
import { mediaInternalAuthorized, startMediaInternalApi } from './internal-api';
import { MediaCommandService } from './command-service';

const guildId = '12345678901234567', room = '22345678901234567', otherRoom = '32345678901234567';
const userId = '42345678901234567', otherId = '52345678901234567', botId = '62345678901234567', ownerId = '72345678901234567';
class Store implements MediaStore {
  settings = mediaSettingsSchema.parse({ enabled: true }); session: MediaSession | null = null; histories: MediaHistoryItem[] = []; receipts = new Map<string, { fingerprint: string }>(); writes = 0;
  async getSettings() { return structuredClone(this.settings); }
  async saveSettings(_guild: string, settings: MediaSettings) { this.settings = settings; }
  async getSession() { return structuredClone(this.session); }
  async receipt(_guild: string, id: string) { return this.receipts.get(id) ?? null; }
  async checkpoint(session: MediaSession, previous: number | null, history: MediaHistoryItem[], _audit: unknown, receipt?: { commandId: string; fingerprint: string }) {
    if ((this.session?.revision ?? null) !== previous) throw new Error('Media state conflict'); this.session = structuredClone(session); this.histories.push(...history); this.writes++;
    if (receipt) this.receipts.set(receipt.commandId, { fingerprint: receipt.fingerprint });
  }
}
function fixture() {
  const store = new Store(); const members = new Map([userId, otherId, ownerId].map((id) => [id, { id, user: { bot: false }, displayName: id, roles: { cache: new Map<string, unknown>() }, voice: { channel: { name: 'Gaming' } } }]));
  const states = new Map([userId, otherId, ownerId].map((id) => [id, { id, channelId: room, member: members.get(id) }]));
  const channels = new Map([room, otherRoom].map((id) => [id, { id, type: ChannelType.GuildVoice, name: id === room ? 'Gaming' : 'General', parentId: null, permissionsFor: () => ({ has: () => true as boolean }) }]));
  const guild = { id: guildId, ownerId, available: true, afkChannelId: null, voiceStates: { cache: states }, channels: { fetch: vi.fn(async (id?: string) => id ? channels.get(id) : channels) }, roles: { fetch: async () => new Map() }, members: { fetch: vi.fn(async ({ user }: { user: string }) => members.get(user)), fetchMe: async () => ({ id: botId }) } } as unknown as Guild;
  const client = { isReady: () => true, user: { id: botId }, guilds: { cache: new Map([[guildId, guild]]) } } as unknown as Client;
  const provider: MediaSourceProvider = { id: 'direct', health: () => ({ id: 'direct', name: 'Direct', state: 'available', capabilities: { search: true, metadata: true, playback: true, live: true, seek: false, playlists: false } }),
    search: async () => [], resolve: vi.fn(async (id): Promise<MediaTrack> => ({ provider: 'direct', providerItemId: id, title: id, artist: 'Artist', type: 'track', durationMs: 60000, externalUrl: 'https://audio.example/track.mp3', artworkUrl: null, playable: true, seekable: false, explicit: null })), getPlayableResource: vi.fn(async () => new PassThrough() as unknown as IncomingMessage) };
  const engine = { connect: vi.fn(async () => undefined), play: vi.fn<PlaybackEngine['play']>(async (...args) => { await args[5]?.(); }), seek: vi.fn<PlaybackEngine['seek']>(async () => undefined), pause: vi.fn(), resume: vi.fn(), volume: vi.fn(), stop: vi.fn(), destroy: vi.fn() };
  let event: (event: EngineEvent) => void = () => undefined;
  const mappings = { accessMappings: async () => ({ roles: [{ discordRoleId: guildId, appRole: 'VIEWER' as const }], members: [] }) };
  const createService = () => new MediaSessionService(client, store, mappings, new MediaSourceRegistry([provider]), (_id, next) => { event = next; return engine; }, { available: true, ffmpeg: true, opus: true, dave: true });
  const service = createService();
  const command = (action: MediaAction, actorUserId = userId): MediaCommand => ({ commandId: randomUUID(), guildId, actorUserId, sessionId: store.session?.sessionId ?? null, expectedQueueVersion: store.session?.queueVersion ?? null, action });
  const add = (id: string, actor = userId) => service.execute(command({ type: 'ADD_TRACK', provider: 'direct', providerItemId: id }, actor));
  const voice = async (id: string, to: string | null) => { const from = states.get(id)?.channelId ?? null; const member = members.get(id)!; if (to) states.set(id, { id, channelId: to, member }); else states.delete(id); await service.voiceState({ id, guild, channelId: from } as VoiceState, { id, guild, channelId: to } as VoiceState); };
  return { store, members, states, channels, guild, client, engine, service, provider, command, add, voice, createService, event: (value: EngineEvent) => event(value) };
}
afterEach(() => vi.useRealTimers());
describe('Media session commands', () => {
  it('leaves after the configured paused time without extending it on polls or unrelated commands', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.settings.inactivityDisconnectSeconds = 10;
    await f.add('first'); await f.add('second'); await f.service.execute(f.command({ type: 'PAUSE' }));
    const destroyed = f.engine.destroy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000); await f.service.state(guildId, userId);
    await f.service.execute(f.command({ type: 'SET_VOLUME', volume: 50 }, ownerId));
    await vi.advanceTimersByTimeAsync(3999); expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed);
    await vi.advanceTimersByTimeAsync(1); await f.service.state(guildId, userId);
    expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed + 1);
    expect(f.store.session).toMatchObject({ state: 'idle', currentTrack: null, recoverable: true });
    expect(f.store.session?.queue.map((track) => track.title)).toEqual(['first', 'second']);
    expect(f.store.session?.lastError).toContain('відсутність відтворення');
  });
  it('waits before leaving an exhausted queue even while listeners remain', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.settings.inactivityDisconnectSeconds = 10; await f.add('first');
    const destroyed = f.engine.destroy.mock.calls.length;
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId, playedMs: 60000 }); await f.service.state(guildId, userId);
    expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed);
    await vi.advanceTimersByTimeAsync(10000); await f.service.state(guildId, userId);
    expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed + 1); expect(f.store.session?.recoverable).toBe(false);
  });
  it('does not report playback after reconnecting an idle voice connection', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.settings.inactivityDisconnectSeconds = 10; await f.add('first');
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, userId);
    f.event({ type: 'reconnecting' }); await f.service.state(guildId, userId);
    f.event({ type: 'reconnected' }); await f.service.state(guildId, userId);
    expect(f.store.session?.state).toBe('idle'); const destroyed = f.engine.destroy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000); expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed + 1);
  });
  it.each(['RESUME', 'PLAY_TRACK'] as const)('cancels the idle deadline when %s starts music', async (type) => {
    vi.useFakeTimers(); const f = fixture(); f.store.settings.inactivityDisconnectSeconds = 10; await f.add('first');
    await f.service.execute(f.command({ type: 'PAUSE' })); await vi.advanceTimersByTimeAsync(9000);
    await f.service.execute(f.command(type === 'RESUME' ? { type } : { type, provider: 'direct', providerItemId: 'next' }, ownerId));
    const destroyed = f.engine.destroy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000); expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed); expect(f.store.session?.state).toBe('playing');
    await f.service.shutdown();
  });
  it('supports disabling and shortening an existing idle timeout through authorized settings', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.settings.inactivityDisconnectSeconds = 10; await f.add('first'); await f.service.execute(f.command({ type: 'PAUSE' }));
    await f.service.settings(guildId, ownerId, { ...f.store.settings, inactivityDisconnectSeconds: 0 });
    const destroyed = f.engine.destroy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000); expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed);
    await expect(f.service.settings(guildId, userId, { ...f.store.settings, inactivityDisconnectSeconds: 1 })).rejects.toThrow('media.manage');
    await f.service.settings(guildId, ownerId, { ...f.store.settings, inactivityDisconnectSeconds: 5 });
    await vi.advanceTimersByTimeAsync(1); await f.service.state(guildId, userId);
    expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed + 1);
  });
  it.each(['shutdown', 'lease-loss', 'recovery'] as const)('cleans up inactivity callbacks on %s', async (action) => {
    vi.useFakeTimers(); const f = fixture(); f.store.settings.inactivityDisconnectSeconds = 10; await f.add('first'); await f.service.execute(f.command({ type: 'PAUSE' }));
    if (action === 'shutdown') await f.service.shutdown();
    else if (action === 'lease-loss') f.service.suspendAudio(guildId);
    else await f.service.recover(f.guild);
    const destroyed = f.engine.destroy.mock.calls.length, writes = f.store.writes;
    await vi.advanceTimersByTimeAsync(20000); expect(f.engine.destroy).toHaveBeenCalledTimes(destroyed); expect(f.store.writes).toBe(writes);
  });
  it('stops on premature EOF but advances normally after complete playback', async () => {
    const f = fixture(); await f.add('first'); await f.add('second');
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId, playedMs: 2000 });
    await f.service.state(guildId, userId);
    expect(f.store.session).toMatchObject({ state: 'idle', currentTrack: null, recoverable: true });
    expect(f.store.session?.lastError).toContain('передчасно');
    expect(f.store.session?.queue.map((entry) => entry.title)).toEqual(['first', 'second']);
    const complete = fixture(); await complete.add('first'); await complete.add('second');
    complete.event({ type: 'ended', queueItemId: complete.store.session!.currentTrack!.queueItemId, playedMs: 60000 });
    await complete.service.state(guildId, userId);
    expect(complete.store.session?.currentTrack?.title).toBe('second');
  });
  it('preserves an unknown-duration selected track after starvation without starting or finishing another song', async () => {
    const f = fixture(); const original = f.provider.resolve;
    f.provider.resolve = async (...args) => ({ ...await original(...args), durationMs: null });
    await f.add('selected'); await f.add('next'); f.engine.play.mockClear();
    f.event({ type: 'failed', queueItemId: f.store.session!.currentTrack!.queueItemId, reason: 'Аудіокадри не надходять. Трек збережено.' });
    await f.service.state(guildId, userId);
    expect(f.store.session).toMatchObject({ state: 'idle', currentTrack: null, recoverable: true, lastError: expect.stringContaining('Трек збережено') });
    expect(f.store.session?.queue.map((entry) => entry.title)).toEqual(['selected', 'next']);
    expect(f.store.histories).toHaveLength(0); expect(f.engine.play).not.toHaveBeenCalled();
  });
  it('keeps session, queue and history unchanged until the replacement decoder is ready', async () => {
    const f = fixture(); await f.add('current'); await f.add('selected'); const before = structuredClone(f.store.session);
    let ready!: () => void; const prepared = new Promise<void>((resolve) => { ready = resolve; });
    let decoding!: () => void; const started = new Promise<void>((resolve) => { decoding = resolve; });
    f.engine.play.mockImplementationOnce(async (...args) => { decoding(); await prepared; await args[5]?.(); });
    f.engine.stop.mockClear();
    const switching = f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected' }, ownerId));
    await started; expect(f.store.session).toEqual(before); expect(f.store.histories).toHaveLength(0); expect(f.engine.stop).not.toHaveBeenCalled();
    ready(); const result = await switching;
    expect(result.snapshot.session?.currentTrack?.title).toBe('selected'); expect(f.store.session?.state).toBe('playing');
    expect(f.store.session?.queue).toHaveLength(0); expect(f.store.histories).toHaveLength(1);
    expect(f.engine.stop).not.toHaveBeenCalled();
  });
  it.each([false, true])('does not advance to a different track after manual decoder rejection (active=%s)', async (active) => {
    const f = fixture();
    if (active) { await f.add('current'); await f.add('selected'); await f.add('different'); }
    const before = structuredClone(f.store.session); const stream = new PassThrough() as unknown as IncomingMessage;
    vi.mocked(f.provider.getPlayableResource).mockResolvedValueOnce(stream); f.engine.stop.mockClear(); f.engine.play.mockClear(); f.engine.destroy.mockClear();
    f.engine.play.mockRejectedValueOnce(new Error('Decoder failed'));
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected' }, ownerId))).rejects.toMatchObject({ status: 422 });
    expect(f.store.session).toEqual(before); expect(f.store.histories).toHaveLength(0); expect(f.engine.play).toHaveBeenCalledOnce();
    expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.engine.destroy).not.toHaveBeenCalled(); expect(stream.destroyed).toBe(true);
    expect((await f.service.state(guildId, ownerId)).session).toEqual(before);
  });
  it('rechecks the actor before committing a decoded replacement', async () => {
    const f = fixture(); await f.add('current'); await f.add('selected'); const before = structuredClone(f.store.session);
    f.engine.stop.mockClear(); f.engine.play.mockImplementationOnce(async (...args) => { f.states.delete(ownerId); await args[5]?.(); });
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected' }, ownerId))).rejects.toMatchObject({ status: 403 });
    expect(f.store.session).toEqual(before); expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.store.histories).toHaveLength(0);
  });
  it('fails closed when the prepared switch cannot be persisted', async () => {
    const f = fixture(); await f.add('current'); await f.add('selected'); const before = structuredClone(f.store.session);
    vi.spyOn(f.store, 'checkpoint').mockRejectedValueOnce(new Error('Database unavailable')); f.engine.destroy.mockClear();
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected' }, ownerId))).rejects.toThrow('завершити перемикання');
    expect(f.engine.destroy).toHaveBeenCalledOnce(); expect(f.store.session).toEqual(before);
  });
  it('recovers the persisted session after a failed Voice connection instead of reporting a source rejection', async () => {
    const f = fixture(); await f.add('current'); await f.add('selected'); const before = structuredClone(f.store.session);
    f.engine.destroy.mockClear(); f.engine.play.mockClear(); f.engine.connect.mockRejectedValueOnce(new Error('Voice unavailable'));
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected' }, ownerId))).rejects.toThrow('Voice unavailable');
    expect(f.engine.destroy).toHaveBeenCalledOnce(); expect(f.engine.play).not.toHaveBeenCalled(); expect(f.store.session).toEqual(before);
    const recovered = await f.service.state(guildId, ownerId);
    expect(recovered.session).toMatchObject({ currentTrack: null, recoverable: true, state: 'idle' });
    expect(recovered.session?.queue.map((track) => track.title)).toEqual(['current', 'selected']);
  });
  it('clears a stale provider warning after automatic advancement starts valid audio', async () => {
    const f = fixture(); await f.add('current'); await f.add('blocked'); await f.add('valid');
    vi.mocked(f.provider.getPlayableResource).mockRejectedValueOnce(new MediaSourceError('YouTube вимагає авторизації.'));
    const result = await f.service.execute(f.command({ type: 'SKIP' }, ownerId));
    expect(result.snapshot.session).toMatchObject({ state: 'playing', lastError: null, currentTrack: { title: 'valid' } });
    expect(f.store.histories.find((entry) => entry.track.title === 'blocked')).toMatchObject({ result: 'failed', reason: 'YouTube вимагає авторизації.' });
  });
  it.each([false, true])('seeks without changing the queue/history and preserves paused=%s', async (paused) => {
    const f = fixture(); const resolve = f.provider.resolve; f.provider.resolve = async (id, signal) => ({ ...await resolve(id, signal), seekable: true });
    await f.add('current'); await f.add('next');
    if (paused) await f.service.execute(f.command({ type: 'PAUSE' }, ownerId));
    const before = structuredClone(f.store.session!); const stream = new PassThrough() as unknown as IncomingMessage;
    vi.mocked(f.provider.getPlayableResource).mockResolvedValueOnce(stream);
    const command = f.command({ type: 'SEEK', queueItemId: before.currentTrack!.queueItemId, positionMs: 30000 }, ownerId);
    f.engine.seek.mockImplementationOnce(async (...args) => { await args[6](); });
    await f.service.execute(command); await f.service.execute(command);
    expect(f.engine.seek).toHaveBeenCalledExactlyOnceWith(stream, expect.any(String), 60, 1800, 30000, paused, expect.any(Function));
    expect(f.store.session).toMatchObject({ sessionId: before.sessionId, state: paused ? 'paused' : 'playing', playbackOffsetMs: 30000, queueVersion: before.queueVersion + 1, queue: before.queue, played: before.played });
    expect(f.store.session?.currentTrack?.requestedByUserId).toBe(userId); expect(f.store.histories).toHaveLength(0);
    expect(f.store.session?.currentTrack?.queueItemId).not.toBe(before.currentTrack!.queueItemId);
    expect(f.store.session?.pausedAt).toBe(paused ? f.store.session!.startedAt : null);
    f.event({ type: 'ended', queueItemId: before.currentTrack!.queueItemId }); await f.service.state(guildId, ownerId);
    expect(f.store.session?.currentTrack?.title).toBe('current');
    await expect(f.service.execute(f.command({ type: 'SEEK', queueItemId: before.currentTrack!.queueItemId, positionMs: 10000 }, ownerId))).rejects.toMatchObject({ status: 409 });
    await f.service.execute(f.command({ type: 'SKIP' }, ownerId));
    expect(f.store.session).toMatchObject({ playbackOffsetMs: 0, currentTrack: { title: 'next' } }); stream.destroy();
  });
  it.each(['unsupported', 'past-end', 'source', 'decoder', 'voice'])('keeps the current session on a rejected seek (%s)', async (failure) => {
    const f = fixture(); const resolve = f.provider.resolve; f.provider.resolve = async (id, signal) => ({ ...await resolve(id, signal), seekable: failure !== 'unsupported' });
    await f.add('current'); const before = structuredClone(f.store.session!);
    const stream = new PassThrough() as unknown as IncomingMessage; vi.mocked(f.provider.getPlayableResource).mockResolvedValueOnce(stream);
    if (failure === 'source') f.provider.resolve = async () => { throw new MediaSourceError('Source unavailable'); };
    if (failure === 'decoder') f.engine.seek.mockRejectedValueOnce(new Error('Decoder error'));
    if (failure === 'voice') f.engine.seek.mockImplementationOnce(async (...args) => { f.states.delete(ownerId); await args[6](); });
    f.engine.destroy.mockClear(); f.engine.stop.mockClear();
    await expect(f.service.execute(f.command({ type: 'SEEK', queueItemId: before.currentTrack!.queueItemId, positionMs: failure === 'past-end' ? 60000 : 30000 }, ownerId))).rejects.toMatchObject({ status: failure === 'voice' ? 403 : 422 });
    expect(f.engine.destroy).not.toHaveBeenCalled(); expect(f.engine.stop).not.toHaveBeenCalled();
    expect((await f.service.state(guildId, userId)).session).toEqual(before);
    if (failure === 'decoder' || failure === 'voice') expect(stream.destroyed).toBe(true); else stream.destroy();
  });
  it.each(['queued', 'searched'])('keeps audio and the session alive when a %s track cannot be resolved', async (origin) => {
    const f = fixture(); await f.add('current'); await f.add('queued');
    const before = structuredClone(f.store.session); f.engine.stop.mockClear(); f.engine.destroy.mockClear();
    vi.mocked(f.provider.resolve).mockRejectedValueOnce(new MediaSourceError('Джерело тимчасово недоступне.'));
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: origin }, ownerId))).rejects.toMatchObject({ status: 422 });
    expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.engine.destroy).not.toHaveBeenCalled();
    expect((await f.service.state(guildId, ownerId)).session).toEqual(before);
    await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'queued' }, ownerId));
    expect(f.store.session).toMatchObject({ sessionId: before!.sessionId, state: 'playing', currentTrack: { title: 'queued' } });
  });
  it('checks the replacement audio stream before stopping the current track', async () => {
    const f = fixture(); await f.add('current'); await f.add('queued');
    const before = structuredClone(f.store.session); f.engine.stop.mockClear(); f.engine.destroy.mockClear();
    vi.mocked(f.provider.getPlayableResource).mockRejectedValueOnce(new Error('Audio connection timeout'));
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'queued' }, ownerId))).rejects.toMatchObject({ status: 422 });
    expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.engine.destroy).not.toHaveBeenCalled();
    expect((await f.service.state(guildId, ownerId)).session).toEqual(before);
    await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'queued' }, ownerId));
    expect(f.store.session?.currentTrack?.title).toBe('queued');
  });
  it('uses refreshed metadata and keeps the replacement stream open beyond the preparation timeout', async () => {
    const f = fixture(); await f.add('current'); await f.add('queued'); vi.useFakeTimers();
    const resolve = f.provider.resolve; f.provider.resolve = async (id, signal) => ({ ...await resolve(id, signal), title: `fresh-${id}` });
    const stream = new PassThrough() as unknown as IncomingMessage;
    let signal: AbortSignal | undefined;
    vi.mocked(f.provider.getPlayableResource).mockImplementationOnce(async (_id, value) => { signal = value; return stream; });
    await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'queued' }, ownerId));
    expect(f.store.session?.currentTrack?.title).toBe('fresh-queued');
    expect(f.engine.play).toHaveBeenLastCalledWith(stream, expect.any(String), 60, 1800, expect.any(Number), expect.any(Function));
    await vi.advanceTimersByTimeAsync(16000); expect(signal?.aborted).toBe(false); expect(stream.destroyed).toBe(false); stream.destroy();
  });
  it('releases a prepared source and keeps current playback when the actor leaves Voice during preparation', async () => {
    const f = fixture(); await f.add('current'); await f.add('queued');
    const before = structuredClone(f.store.session); const stream = new PassThrough() as unknown as IncomingMessage;
    vi.mocked(f.provider.getPlayableResource).mockImplementationOnce(async () => { f.states.delete(ownerId); return stream; });
    f.engine.stop.mockClear(); f.engine.destroy.mockClear();
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'queued' }, ownerId))).rejects.toMatchObject({ status: 403 });
    expect(stream.destroyed).toBe(true); expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.engine.destroy).not.toHaveBeenCalled();
    expect((await f.service.state(guildId, userId)).session).toEqual(before);
  });
  it('keeps completed/skipped tracks replayable, advances in order and preserves them across restart', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); await f.add('third');
    const first = f.store.session!.currentTrack!;
    f.event({ type: 'ended', queueItemId: first.queueItemId }); await f.service.state(guildId, userId);
    expect(f.store.session?.currentTrack?.title).toBe('second'); expect(f.store.session?.played.map((item) => item.title)).toEqual(['first']);
    await f.service.execute(f.command({ type: 'SKIP' }, ownerId));
    expect(f.store.session?.played.map((item) => item.title)).toEqual(['first', 'second']);
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, userId);
    const restarted = f.createService(); await restarted.recover(f.guild);
    expect((await restarted.state(guildId, userId)).session?.played.map((item) => item.title)).toEqual(['first', 'second', 'third']);
    await restarted.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'first' }));
    expect(f.store.session?.currentTrack?.title).toBe('first'); expect(f.store.session?.currentTrack?.queueItemId).not.toBe(first.queueItemId);
    expect(f.store.session?.played.map((item) => item.title)).toEqual(['second', 'third']);
    f.event({ type: 'ended', queueItemId: first.queueItemId }); await restarted.state(guildId, userId);
    expect(f.store.session?.currentTrack?.title).toBe('first');
  });
  it('persists search continuation once, keeps manual queue items and advances without further browser commands', async () => {
    const f = fixture(); await f.add('current'); await f.add('manual', otherId);
    f.provider.search = async () => Promise.all(['selected', 'next', 'last'].map((id) => f.provider.resolve(id)));
    await f.service.search(guildId, ownerId, 'songs');
    const command = f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected', following: ['next', 'next', 'last'].map((providerItemId) => ({ provider: 'direct', providerItemId })) }, ownerId);
    await f.service.execute(command); await f.service.execute(command);
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['manual', 'next', 'last']);
    for (const title of ['manual', 'next', 'last']) {
      f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, ownerId);
      expect(f.store.session?.currentTrack?.title).toBe(title);
    }
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, ownerId);
    expect(f.store.session?.state).toBe('idle'); expect(f.store.session?.played.map((item) => item.title)).toEqual(['current', 'selected', 'manual', 'next', 'last']);
    expect(f.engine.play).toHaveBeenCalledTimes(5);
  });
  it('bounds search continuation by live guild/actor limits and ignores prohibited metadata', async () => {
    const f = fixture(); f.store.settings.maxTracksPerUser = 2; f.store.settings.maxQueueItems = 3; f.store.settings.explicitPolicy = 'block';
    f.provider.search = async () => Promise.all(['selected', 'blocked', 'next', 'overflow'].map(async (id) => ({ ...await f.provider.resolve(id), explicit: id === 'blocked' })));
    await f.service.search(guildId, userId, 'songs');
    await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected', following: ['blocked', 'next', 'overflow'].map((providerItemId) => ({ provider: 'direct', providerItemId })) }));
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['next']);
  });
  it('omits unavailable continuation without rejecting the selected song', async () => {
    const f = fixture(); await f.add('current'); f.engine.stop.mockClear();
    const original = f.provider.resolve;
    f.provider.resolve = async (id) => { if (id === 'forged') throw new MediaSourceError('Трек недоступний: видалений, приватний або має обмеження доступу.'); return original(id); };
    const result = await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected', following: ['first', 'forged', 'last'].map((providerItemId) => ({ provider: 'direct', providerItemId })) }, ownerId));
    expect(result.warning).toContain('Частину добірки не додано');
    expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.store.session?.currentTrack?.title).toBe('selected');
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['first', 'last']);
  });
  it('bounds hung continuation, retains cached songs and ignores late source results', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.add('current');
    const original = f.provider.resolve;
    f.provider.search = async () => [await original('cached')]; await f.service.search(guildId, ownerId, 'songs');
    let finish!: (track: MediaTrack) => void; let signal!: AbortSignal;
    const hung = new Promise<MediaTrack>((resolve) => { finish = resolve; });
    f.provider.resolve = async (id, abort) => { if (id === 'hung') { signal = abort!; return hung; } return original(id); };
    const started = Date.now();
    const command = f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected', following: ['hung', 'cached'].map((providerItemId) => ({ provider: 'direct', providerItemId })) }, ownerId));
    await vi.advanceTimersByTimeAsync(2000); const result = await command;
    expect(Date.now() - started).toBe(2000); expect(result.warning).toBeTruthy(); expect(signal.aborted).toBe(true);
    expect(f.store.session?.currentTrack?.title).toBe('selected'); expect(f.store.session?.queue.map((item) => item.title)).toEqual(['cached']);
    finish(await original('hung')); await Promise.resolve();
    expect((await f.service.state(guildId, ownerId)).session?.queue.map((item) => item.title)).toEqual(['cached']);
    expect(f.provider.getPlayableResource).toHaveBeenLastCalledWith('selected', expect.any(AbortSignal));
  });
  it('revalidates restrictions when the next continuation track starts', async () => {
    const f = fixture();
    f.provider.search = async () => Promise.all(['selected', 'next', 'last'].map((id) => f.provider.resolve(id)));
    await f.service.search(guildId, ownerId, 'songs');
    await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected', following: ['next', 'last'].map((providerItemId) => ({ provider: 'direct', providerItemId })) }, ownerId));
    const resolve = f.provider.resolve; f.provider.resolve = async (id) => ({ ...await resolve(id), playable: id !== 'next' });
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, ownerId);
    expect(f.store.session?.currentTrack?.title).toBe('last'); expect(f.store.histories).toContainEqual(expect.objectContaining({ result: 'failed', track: expect.objectContaining({ title: 'next' }) }));
  });
  it('revalidates restored browser search references after the worker search cache is lost', async () => {
    const f = fixture(); f.store.settings.maxTracksPerUser = 2;
    f.provider.search = async () => Promise.all(['first', 'next', 'overflow'].map((id) => f.provider.resolve(id)));
    await f.service.search(guildId, userId, 'songs');
    const restarted = f.createService(); await restarted.recover(f.guild);
    vi.mocked(f.provider.resolve).mockClear();
    await restarted.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'first', following: ['next', 'overflow'].map((providerItemId) => ({ provider: 'direct', providerItemId })) }));
    expect(f.store.session?.currentTrack?.title).toBe('first'); expect(f.store.session?.queue.map((item) => item.title)).toEqual(['next']);
    expect(f.provider.resolve).toHaveBeenCalledWith('next', expect.any(AbortSignal)); expect(f.provider.resolve).not.toHaveBeenCalledWith('overflow', expect.anything());
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await restarted.state(guildId, userId);
    expect(f.store.session?.currentTrack?.title).toBe('next');
  });
  it('permits only authorized removal of played tracks and bounds retained tracks without counting them against requests', async () => {
    const f = fixture(); await f.add('first'); await f.add('other', otherId);
    const first = f.store.session!.currentTrack!;
    f.event({ type: 'ended', queueItemId: first.queueItemId }); await f.service.state(guildId, userId);
    const state = await f.service.state(guildId, otherId); expect(state.queueControls[first.queueItemId]).toEqual({ remove: false, move: false });
    await expect(f.service.execute(f.command({ type: 'REMOVE_QUEUE_ITEM', queueItemId: first.queueItemId, expectedQueueVersion: f.store.session!.queueVersion }, otherId))).rejects.toThrow('дозволу');
    await f.service.execute(f.command({ type: 'REMOVE_QUEUE_ITEM', queueItemId: first.queueItemId, expectedQueueVersion: f.store.session!.queueVersion }));
    expect(f.store.session?.played).toEqual([]);
    for (let index = 0; index < 105; index++) {
      await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: `song-${index}` }, ownerId));
    }
    expect(f.store.session?.played).toHaveLength(100); expect(f.store.session?.played[0]?.title).toBe('song-4');
  });
  it('retains the last confirmed volume after stop, a worker restart and a new playback session', async () => {
    const f = fixture(); await f.add('first');
    await f.service.execute(f.command({ type: 'SET_VOLUME', volume: 23 }, ownerId));
    await f.service.execute(f.command({ type: 'STOP' }, ownerId)); const previousId = f.store.session!.sessionId;
    const restarted = f.createService(); await restarted.recover(f.guild);
    await restarted.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'new' }, ownerId));
    expect(f.store.session?.volume).toBe(23); expect(f.store.session?.sessionId).not.toBe(previousId);
    expect(f.engine.play).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), 23, expect.any(Number), expect.any(Number), expect.any(Function));
  });
  it('clamps remembered volume to a newly lowered guild limit', async () => {
    const f = fixture(); await f.add('first');
    await f.service.execute(f.command({ type: 'SET_VOLUME', volume: 80 }, ownerId)); await f.service.execute(f.command({ type: 'STOP' }, ownerId));
    f.store.settings.maxVolume = 35; f.store.settings.defaultVolume = 20;
    await f.add('new'); expect(f.store.session?.volume).toBe(35);
  });
  it('returns the authorized current snapshot without repeating live membership or settings reads', async () => {
    const f = fixture(); await f.add('first');
    vi.mocked(f.guild.members.fetch).mockClear(); const settings = vi.spyOn(f.store, 'getSettings');
    const result = await f.service.execute(f.command({ type: 'PAUSE' }));
    expect(f.guild.members.fetch).toHaveBeenCalledExactlyOnceWith({ user: userId, force: true });
    expect(settings).toHaveBeenCalledOnce();
    expect(result.snapshot).toMatchObject({ actorVoice: { id: room }, session: { state: 'paused', guildId, currentTrack: { title: 'first' } } });
  });
  it('does not interrupt audio when a play-now source is restricted or the actor leaves during resolution', async () => {
    const f = fixture(); await f.add('first'); const resolve = f.provider.resolve;
    f.engine.stop.mockClear(); f.engine.play.mockClear();
    f.provider.resolve = async (id) => ({ ...await resolve(id), playable: false });
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'restricted' }, ownerId))).rejects.toThrow('лише інформацію');
    f.provider.resolve = async (id) => { f.states.delete(ownerId); return resolve(id); };
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'new' }, ownerId))).rejects.toThrow('Приєднайтеся');
    expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.engine.play).not.toHaveBeenCalled(); expect(f.store.session?.currentTrack?.title).toBe('first');
  });
  it('plays a selected queued track immediately and preserves the remaining order and requester', async () => {
    const f = fixture(); await f.add('first'); await f.add('second', otherId); await f.add('third');
    const queued = f.store.session!.queue[0]!;
    const result = await f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'second' }, ownerId));
    expect(result.snapshot.session?.currentTrack).toMatchObject({ title: 'second', queueItemId: queued.queueItemId, requestedByUserId: otherId });
    expect(result.snapshot.session?.queue.map((item) => item.title)).toEqual(['third']);
    expect(f.store.histories[0]).toMatchObject({ result: 'skipped', track: { title: 'first' } });
    expect(result.snapshot.session?.state).toBe('playing');
  });
  it('does not let an ordinary play-now request skip the current track or discard the queue', async () => {
    const f = fixture(); await f.add('first'); await f.add('second');
    f.engine.stop.mockClear(); f.engine.play.mockClear();
    await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'new' }))).rejects.toThrow('дозволу');
    expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.engine.play).not.toHaveBeenCalled();
    expect(f.store.session?.currentTrack?.title).toBe('first'); expect(f.store.session?.queue.map((item) => item.title)).toEqual(['second']);
  });
  it('starts the selected track in fair mode and can replace a full queue current track', async () => {
    const f = fixture(); f.store.settings.queueMode = 'fair'; f.store.settings.maxQueueItems = 2;
    await f.add('first'); await f.add('next', otherId);
    await f.service.execute(f.command({ type: 'SET_REPEAT', repeatMode: 'queue' }, ownerId));
    const command = f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'selected' }, ownerId);
    await f.service.execute(command); await f.service.execute(command);
    expect(f.store.session?.currentTrack?.title).toBe('selected');
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['next']);
    expect(f.engine.play).toHaveBeenCalledTimes(2);
  });
  it('joins, plays, pauses, resumes, skips and disconnects through one engine', async () => {
    const f = fixture(); await f.add('first'); expect(f.engine.connect).toHaveBeenCalledWith(f.guild, room, expect.any(Number)); expect(f.store.session?.state).toBe('playing');
    await f.service.execute(f.command({ type: 'PAUSE' })); expect(f.store.session?.state).toBe('paused'); await f.service.execute(f.command({ type: 'RESUME' })); expect(f.engine.resume).toHaveBeenCalled();
    await f.add('second'); await f.service.execute(f.command({ type: 'SKIP' }, ownerId)); expect(f.store.session?.currentTrack?.title).toBe('second'); expect(f.store.histories[0]?.result).toBe('skipped');
    await f.service.execute(f.command({ type: 'STOP' }, ownerId)); expect(f.store.session?.state).toBe('idle'); expect(f.engine.destroy).toHaveBeenCalled();
  });
  it('denies outside/different Voice, cross-guild and nonexistent actors', async () => {
    const f = fixture(); f.states.delete(userId); await expect(f.add('first')).rejects.toThrow('Приєднайтеся'); f.states.set(userId, { id: userId, channelId: room, member: f.members.get(userId) }); await f.add('first');
    await f.voice(userId, otherRoom); await expect(f.service.execute(f.command({ type: 'PAUSE' }))).rejects.toThrow('Приєднайтеся');
    await expect(f.service.execute({ ...f.command({ type: 'PAUSE' }), guildId: '82345678901234567' })).rejects.toThrow('Сервер');
    await expect(f.service.execute({ ...f.command({ type: 'PAUSE' }), actorUserId: '92345678901234567' })).rejects.toThrow('Учасника');
  });
  it('revalidates voice after slow provider resolution', async () => {
    const f = fixture(); const original = f.provider.resolve; f.provider.resolve = async (id) => { f.states.delete(userId); return original(id); };
    await expect(f.add('first')).rejects.toThrow('Приєднайтеся'); expect(f.engine.connect).not.toHaveBeenCalled();
  });
  it('honors effective channel permissions and media.manage remote configuration', async () => {
    const f = fixture(); f.channels.get(room)!.permissionsFor = () => ({ has: () => false }); await expect(f.add('first')).rejects.toThrow('Speak'); f.channels.get(room)!.permissionsFor = () => ({ has: () => true }); await f.add('first');
    await f.voice(ownerId, otherRoom); await expect(f.service.execute(f.command({ type: 'PAUSE' }, ownerId))).rejects.toThrow('Приєднайтеся'); f.store.settings.allowRemoteAdminControl = true;
    await f.service.execute(f.command({ type: 'PAUSE' }, ownerId)); expect(f.store.session?.state).toBe('paused');
  });
  it('rejects stale double skip and replays the same command without audible effects', async () => {
    const f = fixture(); const initial = f.command({ type: 'ADD_TRACK', provider: 'direct', providerItemId: 'first' }); await f.service.execute(initial); await f.service.execute(initial); expect(f.engine.play).toHaveBeenCalledTimes(1);
    await f.add('second'); await f.add('third'); const skip = f.command({ type: 'SKIP' }, ownerId); await f.service.execute(skip);
    await expect(f.service.execute({ ...skip, commandId: randomUUID() })).rejects.toThrow('змінилися'); expect(f.store.session?.currentTrack?.title).toBe('second');
    await expect(f.service.execute({ ...initial, action: { type: 'STOP' } })).rejects.toThrow('already used');
  });
  it('enforces own edits, limits, duplicates and versioned queue movement', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); await expect(f.add('second')).rejects.toThrow('вже додали');
    await f.add('other', otherId); const item = f.store.session!.queue.find((item) => item.requestedByUserId === otherId)!;
    await expect(f.service.execute(f.command({ type: 'REMOVE_QUEUE_ITEM', queueItemId: item.queueItemId, expectedQueueVersion: f.store.session!.queueVersion }))).rejects.toThrow('дозволу');
    f.store.settings.maxQueueItems = 3; await expect(f.add('full')).rejects.toThrow('ліміту'); f.store.settings.maxQueueItems = 100; f.store.settings.maxTracksPerUser = 2; await expect(f.add('per-user')).rejects.toThrow('ліміту');
  });
  it('preserves the interrupted track and queue instead of skipping after engine errors', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); const id = f.store.session!.currentTrack!.queueItemId;
    f.event({ type: 'failed', queueItemId: id, reason: 'stream failed' }); await f.service.state(guildId, userId);
    expect(f.store.session).toMatchObject({ currentTrack: null, state: 'idle', recoverable: true, lastError: 'stream failed' });
    expect(f.store.session?.queue.map((track) => track.title)).toEqual(['first', 'second']);
    const calls = f.engine.play.mock.calls.length;
    f.event({ type: 'ended', queueItemId: id }); await f.service.state(guildId, userId);
    expect(f.engine.play).toHaveBeenCalledTimes(calls);
  });
  it('applies own-reorder limits when a duplicate is configured to move forward', async () => {
    const f = fixture(); await f.add('first'); await f.add('other', otherId); await f.add('own');
    f.store.settings.duplicatePolicy = 'move_existing';
    await expect(f.add('own')).rejects.toThrow('лише між власними');
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['other', 'own']);
  });
  it('recalculates votes on leave, ignores bots and does not persist presentation updates', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); const before = f.store.writes;
    await f.service.execute(f.command({ type: 'VOTE_SKIP' })); const state = await f.service.state(guildId, userId); expect(state.votes).toEqual({ count: 1, required: 2 });
    await f.voice(ownerId, null); await f.voice(otherId, null); expect(f.store.session?.currentTrack?.title).toBe('second'); expect((await f.service.state(guildId, userId)).votes.count).toBe(0); expect(f.store.writes).toBeGreaterThan(before);
  });
  it('preserves interrupted current track at the front and requires explicit restore', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); await f.service.shutdown(); expect(f.store.session?.queue.map((item) => item.title)).toEqual(['first', 'second']);
    const restarted = f.createService(); await restarted.recover(f.guild); f.engine.play.mockClear(); const snapshot = await restarted.state(guildId, userId); expect(snapshot.session?.recoverable).toBe(true); expect(f.engine.play).not.toHaveBeenCalled();
    await restarted.execute(f.command({ type: 'RESTORE' })); expect(f.store.session?.currentTrack?.title).toBe('first');
  });
  it('reloads persisted state when ownership returns instead of checkpointing a stale runtime', async () => {
    const f = fixture(); await f.add('first'); await f.service.interruptGuild(guildId, 'Lease lost');
    const latest = structuredClone(f.store.session!); latest.revision += 5; latest.volume = 35;
    f.store.session = latest; f.engine.play.mockClear();
    await f.service.recover(f.guild);
    const snapshot = await f.service.state(guildId, userId);
    expect(snapshot.session?.volume).toBe(35); expect(snapshot.session?.revision).toBe(latest.revision + 1);
    expect(snapshot.session?.queue.map((item) => item.title)).toEqual(['first']);
    expect(snapshot.session?.recoverable).toBe(true); expect(f.engine.play).not.toHaveBeenCalled();
  });
  it('does not let pending or new ordinary votes bypass a DJ lock', async () => {
    const f = fixture(); await f.add('first'); await f.add('second');
    await f.service.execute(f.command({ type: 'VOTE_SKIP' }));
    await f.service.execute(f.command({ type: 'SET_LOCK', lockedMode: 'dj' }, ownerId));
    expect((await f.service.state(guildId, userId)).votes.count).toBe(0);
    await expect(f.service.execute(f.command({ type: 'VOTE_SKIP' }))).rejects.toThrow('DJ');
    await f.voice(ownerId, null); await f.voice(otherId, null);
    expect(f.store.session?.currentTrack?.title).toBe('first');
  });
  it('stops audio immediately even while a serialized operation is pending', async () => {
    const f = fixture(); await f.add('first');
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const pending = f.service.exclusive(guildId, async () => { entered(); await gate; });
    await ready; f.engine.destroy.mockClear();
    const shutdown = f.service.shutdown();
    expect(f.engine.destroy).toHaveBeenCalledTimes(1);
    release(); await Promise.all([pending, shutdown]);
    expect(f.store.session?.currentTrack).toBeNull();
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['first']);
  });
  it('pauses an empty channel, cancels grace on rejoin and leaves without autoplay', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.add('first'); await f.voice(otherId, null); await f.voice(ownerId, null); await f.voice(userId, null); expect(f.store.session?.state).toBe('paused');
    await vi.advanceTimersByTimeAsync(10000); await f.voice(userId, room); expect(f.store.session?.state).toBe('paused'); await vi.advanceTimersByTimeAsync(130000); expect(f.store.session?.currentTrack).not.toBeNull();
    await f.voice(userId, null); await vi.advanceTimersByTimeAsync(120001); expect(f.store.session?.state).toBe('idle'); expect(f.store.session?.recoverable).toBe(true);
  });
  it('handles deletion of a temporary room without losing the queue', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); await f.service.channelDeleted(guildId, room); expect(f.store.session?.state).toBe('idle'); expect(f.store.session?.queue).toHaveLength(2);
  });
  it('lets a manager restore a deleted room queue in their current Voice without remote override', async () => {
    const f = fixture(); await f.add('first'); await f.add('second');
    await f.service.channelDeleted(guildId, room); f.channels.delete(room);
    await f.voice(ownerId, otherRoom); await f.voice(userId, otherRoom);
    expect((await f.service.state(guildId, ownerId)).controls.RESTORE).toBe(true);
    expect((await f.service.state(guildId, userId)).controls.RESTORE).toBe(false);
    await expect(f.service.execute(f.command({ type: 'RESTORE' }))).rejects.toThrow('адміністратора');
    f.engine.connect.mockClear(); f.engine.play.mockClear();
    await f.service.execute(f.command({ type: 'RESTORE' }, ownerId));
    expect(f.engine.connect).toHaveBeenCalledWith(f.guild, otherRoom, expect.any(Number));
    expect(f.engine.play).toHaveBeenCalledTimes(1);
    expect(f.store.session).toMatchObject({ voiceChannelId: otherRoom, voiceChannelName: 'General', state: 'playing', recoverable: false, lastError: null });
    expect(f.store.session?.currentTrack?.title).toBe('first');
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['second']);
    expect((await f.service.state(guildId, userId)).controls.ADD_TRACK).toBe(true);
  });
  it('keeps the saved queue when the manager target Voice is blocked', async () => {
    const f = fixture(); await f.add('first'); await f.service.channelDeleted(guildId, room);
    await f.voice(ownerId, otherRoom); f.store.settings.blockedVoiceChannelIds = [otherRoom];
    const saved = structuredClone(f.store.session); f.engine.connect.mockClear(); f.engine.play.mockClear();
    await expect(f.service.execute(f.command({ type: 'RESTORE' }, ownerId))).rejects.toThrow('не дозволений');
    expect(f.store.session).toEqual(saved);
    expect(f.engine.connect).not.toHaveBeenCalled(); expect(f.engine.play).not.toHaveBeenCalled();
  });
  it('rechecks manager location after fetching the restore target before joining', async () => {
    const f = fixture(); await f.add('first'); await f.service.channelDeleted(guildId, room);
    await f.voice(ownerId, otherRoom);
    vi.spyOn(f.guild.channels, 'fetch').mockImplementationOnce(async () => { f.states.delete(ownerId); return f.channels.get(otherRoom)! as never; });
    const saved = structuredClone(f.store.session); f.engine.connect.mockClear(); f.engine.play.mockClear();
    await expect(f.service.execute(f.command({ type: 'RESTORE' }, ownerId))).rejects.toThrow('Голосовий канал змінився');
    expect(f.store.session).toEqual(saved);
    expect(f.engine.connect).not.toHaveBeenCalled(); expect(f.engine.play).not.toHaveBeenCalled();
  });
  it('preserves a track when every listener leaves during connection', async () => {
    const f = fixture(); f.engine.connect.mockImplementation(async () => { f.states.clear(); });
    await f.add('first');
    expect(f.engine.play).not.toHaveBeenCalled(); expect(f.store.histories).toHaveLength(0);
    expect(f.store.session?.recoverable).toBe(true);
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['first']);
  });
  it('rechecks manager location before moving an active session and keeps audio untouched on denial', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); await f.voice(ownerId, otherRoom);
    vi.spyOn(f.guild.channels, 'fetch').mockImplementationOnce(async () => { f.states.delete(ownerId); return f.channels.get(otherRoom)! as never; });
    const saved = structuredClone(f.store.session); f.engine.stop.mockClear(); f.engine.connect.mockClear(); f.engine.play.mockClear();
    await expect(f.service.execute(f.command({ type: 'MOVE_SESSION' }, ownerId))).rejects.toThrow('Голосовий канал змінився');
    expect(f.store.session).toEqual(saved);
    expect(f.engine.stop).not.toHaveBeenCalled(); expect(f.engine.connect).not.toHaveBeenCalled(); expect(f.engine.play).not.toHaveBeenCalled();
  });
  it('stops an active session when its channel is blocked in settings and preserves the whole queue', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); f.engine.destroy.mockClear();
    await f.service.settings(guildId, ownerId, { ...f.store.settings, blockedVoiceChannelIds: [room] });
    expect(f.engine.destroy).toHaveBeenCalled(); expect(f.store.session).toMatchObject({ state: 'idle', recoverable: true, currentTrack: null });
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['first', 'second']);
    await expect(f.service.execute(f.command({ type: 'RESTORE' }, ownerId))).rejects.toThrow('не дозволений');
  });
  it('rechecks channel permissions before advancing without marking queued tracks as failed', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); f.engine.play.mockClear();
    f.channels.get(room)!.permissionsFor = () => ({ has: () => false });
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId });
    await f.service.exclusive(guildId, async () => undefined);
    expect(f.engine.play).not.toHaveBeenCalled(); expect(f.store.session).toMatchObject({ state: 'idle', recoverable: true, currentTrack: null });
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['second']);
    expect(f.store.histories.map((item) => item.result)).toEqual(['finished']);
  });
  it('preserves upcoming tracks when the channel becomes empty before a track ends', async () => {
    const f = fixture(); await f.add('first'); await f.add('second'); f.states.clear();
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId });
    await f.service.exclusive(guildId, async () => undefined);
    expect(f.store.histories.map((item) => item.result)).toEqual(['finished']);
    expect(f.store.session?.queue.map((item) => item.title)).toEqual(['second']);
    expect(f.store.session?.recoverable).toBe(true);
  });
  it('tracks a valid manual move and conservatively interrupts a disconnect', async () => {
    const f = fixture(); await f.add('first');
    await f.service.voiceState({ id: botId, guild: f.guild, channelId: room } as VoiceState, { id: botId, guild: f.guild, channelId: otherRoom } as VoiceState); expect(f.store.session?.voiceChannelId).toBe(otherRoom);
    await f.service.voiceState({ id: botId, guild: f.guild, channelId: otherRoom } as VoiceState, { id: botId, guild: f.guild, channelId: null } as VoiceState); expect(f.store.session?.recoverable).toBe(true); expect(f.store.session?.currentTrack).toBeNull();
  });
  it('honors repeat-track ahead of fair rotation, never repeats failures', async () => {
    const f = fixture(); f.store.settings.queueMode = 'fair'; await f.add('first'); await f.add('second', otherId); await f.service.execute(f.command({ type: 'SET_REPEAT', repeatMode: 'track' }, ownerId));
    f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, userId); expect(f.store.session?.currentTrack?.title).toBe('first');
    f.event({ type: 'failed', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, userId); expect(f.store.session?.currentTrack).toBeNull(); expect(f.store.session?.recoverable).toBe(true);
  });
  it('allows a new session in another Voice after the old queue ends', async () => {
    const f = fixture(); await f.add('first'); f.event({ type: 'ended', queueItemId: f.store.session!.currentTrack!.queueItemId }); await f.service.state(guildId, userId); await f.voice(userId, otherRoom); await f.add('new'); expect(f.store.session?.voiceChannelId).toBe(otherRoom);
  });
});
describe('authenticated internal endpoint', () => {
  it('correlates authenticated web/worker requests and replaces an invalid trace header without logging it', async () => {
    const f = fixture(); const secret = 'c'.repeat(32); const expectedId = randomUUID();
    const server = await startMediaInternalApi(new MediaCommandService(f.service), { secret, host: '127.0.0.1', port: 0 });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
      for (const correlation of [expectedId, 'token=never-log-this']) {
        const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
        const response = await fetch(`http://127.0.0.1:${address.port}/internal/media`, {
          method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'X-SCRT-Request': correlation },
          body: JSON.stringify({ operation: 'search', guildId, actorUserId: ownerId, query: 'songs', page: 0 }),
        });
        expect(response.status).toBe(200); await response.json();
        const entries = runtimeLogSnapshot({ runId: before.runId, after }).entries;
        const started = entries.find((entry) => entry.action === 'internal.request.started');
        const completed = entries.find((entry) => entry.action === 'internal.request.completed');
        expect(started?.context.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(completed?.context).toMatchObject({ requestId: started?.context.requestId, guildId, operation: 'search', status: 200 });
        if (correlation === expectedId) expect(started?.context.requestId).toBe(expectedId);
        expect(JSON.stringify(entries)).not.toContain('never-log-this'); expect(JSON.stringify(entries)).not.toContain(secret);
      }
      expect(f.store.writes).toBe(0);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('requires both service authentication and the specific admin identity for runtime logs', async () => {
    const f = fixture(); const secret = 'l'.repeat(32);
    const server = await startMediaInternalApi(new MediaCommandService(f.service), { secret, host: '127.0.0.1', port: 0 });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
      const url = `http://127.0.0.1:${address.port}/internal/logs`;
      expect((await fetch(url, { headers: { 'X-SCRT-Actor': '1409339485904306200' } })).status).toBe(401);
      expect((await fetch(url, { headers: { Authorization: `Bearer ${secret}`, 'X-SCRT-Actor': ownerId } })).status).toBe(403);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}`, 'X-SCRT-Actor': '1409339485904306200' } });
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ runId: expect.any(String), entries: expect.any(Array) });
      expect(f.store.writes).toBe(0);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('reports a source access refusal without changing the queue or misreporting a worker failure', async () => {
    const f = fixture(); const message = 'YouTube вимагає авторизації для цього запиту.';
    vi.spyOn(f.provider, 'resolve').mockRejectedValue(new MediaSourceError(message));
    const secret = 's'.repeat(32);
    const server = await startMediaInternalApi(new MediaCommandService(f.service), { secret, host: '127.0.0.1', port: 0 });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
      const response = await fetch(`http://127.0.0.1:${address.port}/internal/media`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ operation: 'command', command: f.command({ type: 'ADD_TRACK', provider: 'direct', providerItemId: 'https://audio.example/track.mp3' }) }) });
      expect(response.status).toBe(422); expect(await response.json()).toEqual({ error: message });
      expect(f.store.writes).toBe(0); expect(f.engine.play).not.toHaveBeenCalled();
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('serves a safe startup error and refuses settings writes before Discord is ready', async () => {
    const f = fixture(); vi.spyOn(f.client, 'isReady').mockReturnValue(false);
    const secret = 'c'.repeat(32);
    const server = await startMediaInternalApi(new MediaCommandService(f.service), { secret, host: '127.0.0.1', port: 0 });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
      const response = await fetch(`http://127.0.0.1:${address.port}/internal/media`, {
        method: 'POST', headers: { Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ operation: 'settings', guildId, actorUserId: ownerId, settings: { ...f.store.settings, enabled: false } }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: expect.stringContaining('ще не підключився до Discord') });
      expect(f.store.settings.enabled).toBe(true);
      expect(f.store.writes).toBe(0);
      expect(f.guild.members.fetch).not.toHaveBeenCalled();
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('compares a strong bearer secret without accepting prefixes', () => { const secret = 'a'.repeat(32); expect(mediaInternalAuthorized(`Bearer ${secret}`, secret)).toBe(true); expect(mediaInternalAuthorized(`Bearer ${secret}x`, secret)).toBe(false); expect(mediaInternalAuthorized(undefined, secret)).toBe(false); });
  it('rejects unauthorized HTTP requests and malformed authenticated payloads', async () => {
    const f = fixture(); const secret = 'b'.repeat(32); const server = await startMediaInternalApi(new MediaCommandService(f.service), { secret, host: '127.0.0.1', port: 0 });
    try { const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port'); const url = `http://127.0.0.1:${address.port}/internal/media`;
      expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401);
      expect((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: '{"operation":"command","actorUserId":"forged"}' })).status).toBe(400);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

it('does not checkpoint recovered state after losing ownership during a cold read', async () => {
 const f = fixture(); await f.add('first'); const persisted = structuredClone(f.store.session); const before = f.store.writes;
 let owned = true; const originalRead = f.store.getSession.bind(f.store);
 vi.spyOn(f.store, 'getSession').mockImplementationOnce(async () => { const value = await originalRead(); owned = false; return value; });
 await expect(f.createService().recover(f.guild, () => owned)).rejects.toMatchObject({ status: 503 });
 expect(f.store.session).toEqual(persisted); expect(f.store.writes).toBe(before);
});
it('records a source rejection with guild/provider context without logging its track URL', async () => {
 const f = fixture(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 try {
  vi.mocked(f.provider.resolve).mockRejectedValueOnce(new MediaSourceError('Джерело тимчасово не відповідає.'));
  await expect(f.service.execute(f.command({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'https://audio.example/track.mp3?signature=private' }, ownerId))).rejects.toMatchObject({ status: 422 });
  expect(warn).toHaveBeenCalledOnce(); const entry = JSON.parse(String(warn.mock.calls[0]![0]));
  expect(entry).toMatchObject({ guildId, provider: 'direct', action: 'command.source.rejected', commandType: 'PLAY_TRACK', status: 422 });
  expect(JSON.stringify(entry)).not.toContain('signature');
 } finally { warn.mockRestore(); }
});

it('recovers an active persisted session in one checkpoint', async () => {
 const f = fixture(); await f.add('first'); const previous = f.store.writes; const oldIdentity = f.store.session!.sessionId;
 await f.createService().recover(f.guild);
 expect(f.store.writes).toBe(previous + 1); expect(f.store.session!.sessionId).not.toBe(oldIdentity);
 expect(f.store.session!.currentTrack).toBeNull(); expect(f.store.session!.queue.map((item) => item.title)).toEqual(['first']);
});
