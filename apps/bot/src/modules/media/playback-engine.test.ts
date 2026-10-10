import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guild } from 'discord.js';

const voice = vi.hoisted(() => ({
  AudioPlayerStatus: { Idle: 'idle', Playing: 'playing', Paused: 'paused' },
  VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Connecting: 'connecting', Signalling: 'signalling', Destroyed: 'destroyed' },
  NoSubscriberBehavior: { Pause: 'pause' }, StreamType: { Raw: 'raw' },
  createAudioPlayer: vi.fn(), createAudioResource: vi.fn(), joinVoiceChannel: vi.fn(), entersState: vi.fn(),
}));
vi.mock('node:module', () => ({ createRequire: () => () => voice }));
const subprocess = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:child_process', () => subprocess);
import { MediaPlaybackEngine } from './playback-engine';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const guild = { id: '12345678901234567', voiceAdapterCreator: {} } as Guild;
function fixture() {
  const player = Object.assign(new EventEmitter(), { state: { status: 'playing', resource: null as unknown }, pause: vi.fn(), unpause: vi.fn(), stop: vi.fn(), play: vi.fn() });
  player.play.mockImplementation((resource) => { player.state = { status: 'playing', resource }; });
  player.stop.mockImplementation(() => { const previous = player.state; player.state = { status: 'idle', resource: null }; player.emit('idle', previous); });
  const processes: Array<ReturnType<typeof child>> = [];
  function child() { return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() }); }
  subprocess.spawn.mockImplementation(() => { const value = child(); processes.push(value); return value; });
  voice.createAudioResource.mockImplementation((playStream) => ({ playStream, volume: { setVolume: vi.fn() } }));
  const connections: Array<ReturnType<typeof connection>> = [];
  function connection(channelId: string) {
    return Object.assign(new EventEmitter(), { joinConfig: { channelId }, state: { status: 'ready' }, destroy: vi.fn(), subscribe: vi.fn() });
  }
  voice.createAudioPlayer.mockReturnValue(player);
  voice.joinVoiceChannel.mockImplementation(({ channelId }) => { const value = connection(channelId); connections.push(value); return value; });
  voice.entersState.mockResolvedValue(undefined);
  const event = vi.fn(); const engine = new MediaPlaybackEngine(event);
  return { engine, player, event, connections, processes };
}
beforeEach(() => vi.resetAllMocks());

function input() { return Object.assign(new PassThrough(), { setTimeout: vi.fn() }) as unknown as IncomingMessage; }
describe('Media track replacement lifecycle', () => {
  it('keeps old audio through decoder preparation and persistence, then installs only the selected resource', async () => {
    const f = fixture(); const oldInput = input(), nextInput = input();
    await f.engine.play(oldInput, 'old', 60, 60); const oldResource = f.player.state.resource;
    const checkpoint = deferred(); const commit = vi.fn(() => checkpoint.promise);
    const switching = f.engine.play(nextInput, 'selected', 60, 60, 15000, commit);
    expect(commit).not.toHaveBeenCalled(); expect(f.player.state.resource).toBe(oldResource);
    f.processes[1]!.stdout.write(Buffer.alloc(3840));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(commit).toHaveBeenCalledOnce(); expect(oldInput.destroyed).toBe(false); expect(f.player.state.resource).toBe(oldResource);
    checkpoint.resolve(); await switching;
    expect(oldInput.destroyed).toBe(true); expect(f.player.state.resource).not.toBe(oldResource); expect(f.player.play).toHaveBeenCalledTimes(2);
    f.player.emit('idle', { resource: oldResource }); f.processes[0]!.emit('close', 1); expect(f.event).not.toHaveBeenCalled();
    f.player.emit('idle', { resource: f.player.state.resource }); expect(f.event).toHaveBeenCalledExactlyOnceWith({ type: 'ended', queueItemId: 'selected' });
    f.engine.destroy();
  });
  it.each(['decoder', 'empty', 'permission'])('preserves old audio and releases a rejected replacement (%s)', async (failure) => {
    const f = fixture(); const oldInput = input(), nextInput = input();
    await f.engine.play(oldInput, 'old', 60, 60); const resource = f.player.state.resource;
    const commit = vi.fn(async () => { if (failure === 'permission') throw new Error('Left Voice'); });
    const switching = f.engine.play(nextInput, 'selected', 60, 60, 15000, commit); const rejected = expect(switching).rejects.toThrow();
    if (failure === 'decoder') f.processes[1]!.emit('close', 1);
    else if (failure === 'empty') f.processes[1]!.stdout.emit('readable');
    else f.processes[1]!.stdout.write(Buffer.alloc(3840));
    await rejected;
    expect(f.player.state.resource).toBe(resource); expect(oldInput.destroyed).toBe(false); expect(nextInput.destroyed).toBe(true);
    expect(f.processes[1]!.kill).toHaveBeenCalledOnce(); expect(f.player.play).toHaveBeenCalledOnce(); expect(f.event).not.toHaveBeenCalled(); f.engine.destroy();
  });
  it('ignores old decoder, player and input errors after switching tracks', async () => {
    const f = fixture(); const oldInput = input();
    await f.engine.play(oldInput, 'old', 60, 60); const oldResource = f.player.state.resource;
    await f.engine.play(input(), 'new', 60, 60); const currentResource = f.player.state.resource;
    f.player.emit('error', { resource: oldResource }); f.player.emit('idle', { resource: oldResource });
    f.processes[0]!.emit('close', 1); oldInput.emit('error', new Error('Old stream closed'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.event).not.toHaveBeenCalled(); expect(f.player.state.resource).toBe(currentResource);
    f.player.emit('idle', { resource: currentResource });
    expect(f.event).toHaveBeenCalledExactlyOnceWith({ type: 'ended', queueItemId: 'new' }); f.engine.destroy();
  });
  it('reports a current resource failure once without treating cleanup as a finished track', async () => {
    const f = fixture(); await f.engine.play(input(), 'current', 60, 60);
    const resource = f.player.state.resource; f.player.emit('error', { resource });
    f.player.emit('idle', { resource }); f.processes[0]!.emit('close', 1);
    expect(f.event).toHaveBeenCalledExactlyOnceWith({ type: 'failed', queueItemId: 'current', reason: 'Помилка декодування аудіо.' }); f.engine.destroy();
  });
  it('does not acknowledge playback that failed while waiting for the playing state', async () => {
    const f = fixture(); const ready = deferred(); voice.entersState.mockReturnValueOnce(ready.promise);
    const playing = f.engine.play(input(), 'current', 60, 60);
    const rejected = expect(playing).rejects.toThrow('перервано під час запуску');
    f.player.emit('error', { resource: f.player.state.resource }); ready.resolve(); await rejected;
    expect(f.event).toHaveBeenCalledOnce(); f.engine.destroy();
  });
});

describe('Media seek preparation', () => {
  it.each([false, true])('keeps the old stream until decoding is ready and preserves paused=%s', async (paused) => {
    const f = fixture(); const oldInput = input(), nextInput = input();
    await f.engine.play(oldInput, 'old', 60, 60); const oldResource = f.player.state.resource;
    const commit = vi.fn(async () => undefined);
    const seeking = f.engine.seek(nextInput, 'seeked', 75, 60, 20000, paused, commit);
    expect(f.player.state.resource).toBe(oldResource); expect(oldInput.destroyed).toBe(false); expect(f.processes[0]!.kill).not.toHaveBeenCalled();
    f.processes[1]!.stdout.write(Buffer.alloc(3840)); await seeking;
    const args = subprocess.spawn.mock.calls[1]![1] as string[];
    expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('20'); expect(args[args.indexOf('-t') + 1]).toBe('40');
    expect(args).toContain('pipe:0'); expect(args).toContain('pipe:1'); expect(args.join(' ')).not.toContain('http');
    expect(commit).toHaveBeenCalledOnce(); expect(oldInput.destroyed).toBe(true); expect(f.processes[0]!.kill).toHaveBeenCalledOnce();
    expect(f.player.state.resource).not.toBe(oldResource); expect(f.player.pause).toHaveBeenCalledTimes(paused ? 1 : 0);
    expect(nextInput.setTimeout).toHaveBeenCalledTimes(paused ? 1 : 0);
    f.player.emit('error', { resource: oldResource }); f.processes[0]!.emit('close', 1);
    expect(f.event).not.toHaveBeenCalled();
    f.player.emit('idle', { resource: f.player.state.resource });
    expect(f.event).toHaveBeenCalledExactlyOnceWith({ type: 'ended', queueItemId: 'seeked' }); f.engine.destroy();
  });
  it.each(['decoder', 'permission', 'empty'])('preserves the current audio when seek preparation fails (%s)', async (failure) => {
    const f = fixture(); const oldInput = input(), nextInput = input();
    await f.engine.play(oldInput, 'old', 60, 60); const resource = f.player.state.resource;
    const seeking = f.engine.seek(nextInput, 'seeked', 60, 60, 10000, false, async () => { if (failure === 'permission') throw new Error('Left Voice'); });
    const rejected = expect(seeking).rejects.toThrow();
    if (failure === 'decoder') f.processes[1]!.emit('close', 1); else if (failure === 'empty') f.processes[1]!.stdout.emit('readable'); else f.processes[1]!.stdout.write(Buffer.alloc(3840));
    await rejected; expect(nextInput.destroyed).toBe(true); expect(f.processes[1]!.kill).toHaveBeenCalledOnce();
    expect(oldInput.destroyed).toBe(false); expect(f.player.state.resource).toBe(resource); expect(f.event).not.toHaveBeenCalled(); f.engine.destroy();
  });
  it('bounds decoder preparation and cancels it when the session stops', async () => {
    const f = fixture(); await f.engine.play(input(), 'old', 60, 60); const resource = f.player.state.resource;
    vi.useFakeTimers();
    try {
      const timedInput = input(); const timed = f.engine.seek(timedInput, 'timed', 60, 60, 10000, false, async () => undefined, 15000);
      const rejected = expect(timed).rejects.toThrow(); await vi.advanceTimersByTimeAsync(15001); await rejected;
      expect(timedInput.destroyed).toBe(true); expect(f.player.state.resource).toBe(resource);
      const cancelledInput = input(); const cancelled = f.engine.seek(cancelledInput, 'cancelled', 60, 60, 10000, false, async () => undefined);
      const cancelledRejection = expect(cancelled).rejects.toThrow(); f.engine.destroy(); f.processes[2]!.stdout.write(Buffer.alloc(3840)); await cancelledRejection;
      expect(cancelledInput.destroyed).toBe(true); expect(f.player.play).toHaveBeenCalledOnce(); expect(f.event).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('does not replace paused audio when Voice disconnects during seek preparation', async () => {
    const f = fixture(); await f.engine.connect(guild, 'room-a'); await f.engine.play(input(), 'old', 60, 60);
    const resource = f.player.state.resource; const reconnect = deferred(); voice.entersState.mockReturnValue(reconnect.promise);
    const nextInput = input(); const seeking = f.engine.seek(nextInput, 'seeked', 60, 60, 10000, false, async () => undefined);
    const rejected = expect(seeking).rejects.toThrow(); f.connections[0]!.emit('disconnected'); f.processes[1]!.stdout.write(Buffer.alloc(3840)); await rejected;
    expect(f.player.state.resource).toBe(resource); expect(nextInput.destroyed).toBe(true); expect(f.player.pause).toHaveBeenCalledOnce();
    expect(f.event).toHaveBeenCalledExactlyOnceWith({ type: 'reconnecting' }); f.engine.destroy(); reconnect.resolve();
  });
});

describe('Media Voice reconnection lifecycle', () => {
  it('does not resume or emit a late reconnection after the session is destroyed', async () => {
    const f = fixture(); await f.engine.connect(guild, 'room-a');
    const ready = deferred();
    voice.entersState.mockImplementation((_connection, state) => state === 'ready' ? ready.promise : Promise.resolve());
    f.connections[0]!.emit('disconnected');
    await vi.waitFor(() => expect(voice.entersState).toHaveBeenLastCalledWith(f.connections[0], 'ready', 15000));
    f.engine.destroy(); ready.resolve();
    await ready.promise;
    expect(f.player.unpause).not.toHaveBeenCalled(); expect(f.event.mock.calls.map(([value]) => value.type)).toEqual(['reconnecting']);
  });
  it('ignores a previous connection completion while a replacement connection is reconnecting', async () => {
    const f = fixture(); await f.engine.connect(guild, 'room-a'); const old = deferred(), current = deferred();
    voice.entersState.mockImplementation((connection, state) => state === 'ready' && connection === f.connections[0] ? old.promise : Promise.resolve());
    f.connections[0]!.emit('disconnected');
    await vi.waitFor(() => expect(voice.entersState).toHaveBeenLastCalledWith(f.connections[0], 'ready', 15000));
    await f.engine.connect(guild, 'room-b');
    voice.entersState.mockImplementation((connection, state) => state === 'ready' && connection === f.connections[1] ? current.promise : Promise.resolve());
    f.connections[1]!.emit('disconnected');
    await vi.waitFor(() => expect(voice.entersState).toHaveBeenLastCalledWith(f.connections[1], 'ready', 15000));
    old.resolve(); await old.promise;
    f.connections[1]!.emit('disconnected');
    expect(f.event.mock.calls.map(([value]) => value.type)).toEqual(['reconnecting', 'reconnecting']);
    current.resolve(); await current.promise;
    expect(f.player.unpause).toHaveBeenCalledOnce();
    expect(f.event).toHaveBeenLastCalledWith({ type: 'reconnected' }); f.engine.destroy();
  });
  it('preserves an intentional pause across a successful reconnect', async () => {
    const f = fixture(); await f.engine.connect(guild, 'room-a'); f.player.state.status = 'paused';
    f.connections[0]!.emit('disconnected');
    await vi.waitFor(() => expect(f.event).toHaveBeenLastCalledWith({ type: 'reconnected' }));
    expect(f.player.unpause).not.toHaveBeenCalled(); f.engine.destroy();
  });
});
