import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guild } from 'discord.js';

const voice = vi.hoisted(() => ({
  AudioPlayerStatus: { Idle: 'idle', Playing: 'playing', Paused: 'paused' },
  VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Connecting: 'connecting', Signalling: 'signalling', Destroyed: 'destroyed' },
  NoSubscriberBehavior: { Pause: 'pause' }, StreamType: { Raw: 'raw' },
  createAudioPlayer: vi.fn(), createAudioResource: vi.fn(), joinVoiceChannel: vi.fn(), entersState: vi.fn(),
}));
vi.mock('node:module', () => ({ createRequire: () => () => voice }));
import { MediaPlaybackEngine } from './playback-engine';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const guild = { id: '12345678901234567', voiceAdapterCreator: {} } as Guild;
function fixture() {
  const player = Object.assign(new EventEmitter(), { state: { status: 'playing' }, pause: vi.fn(), unpause: vi.fn(), stop: vi.fn() });
  const connections: Array<ReturnType<typeof connection>> = [];
  function connection(channelId: string) {
    return Object.assign(new EventEmitter(), { joinConfig: { channelId }, state: { status: 'ready' }, destroy: vi.fn(), subscribe: vi.fn() });
  }
  voice.createAudioPlayer.mockReturnValue(player);
  voice.joinVoiceChannel.mockImplementation(({ channelId }) => { const value = connection(channelId); connections.push(value); return value; });
  voice.entersState.mockResolvedValue(undefined);
  const event = vi.fn(); const engine = new MediaPlaybackEngine(event);
  return { engine, player, event, connections };
}
beforeEach(() => vi.resetAllMocks());

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
