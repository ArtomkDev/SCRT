// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { mediaSettingsSchema, mediaSnapshotSchema, type MediaSnapshot } from '@scrt/validation';
import { useMediaController } from './player-controller';

const guildId = '12345678901234567';
const ids = ['e1f2d646-c71b-447e-8f8b-1d537d3b17c0', 'e1f2d646-c71b-447e-8f8b-1d537d3b17c1', 'e1f2d646-c71b-447e-8f8b-1d537d3b17c2'];
function snapshot(): MediaSnapshot {
  const item = (title: string, index: number) => ({ provider: 'direct', providerItemId: `https://audio.example/${title}.mp3`, title, artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: `https://audio.example/${title}.mp3`, playable: true, seekable: false, explicit: null, queueItemId: ids[index], requestedByUserId: guildId, requestedByName: 'Listener', requestedAt: 1 });
  return mediaSnapshotSchema.parse({
    session: { sessionId: ids[0], guildId, voiceChannelId: '22345678901234567', voiceChannelName: 'Gaming', state: 'playing', currentTrack: item('current', 0), queue: [item('second', 1), item('third', 2)], startedAt: Date.now() - 10000, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null },
    settings: mediaSettingsSchema.parse({ enabled: true }), controls: { PAUSE: true, RESUME: true }, queueControls: {}, actorVoice: { id: '22345678901234567', name: 'Gaming' }, remoteControl: false, listenerCount: 1, votes: { count: 0, required: 1 }, engine: { available: true, ffmpeg: true, opus: true, dave: true }, serverTimestamp: Date.now(), canManage: true, providers: [],
  });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((next) => { resolve = next; });
  return { promise, resolve };
}
function ack(value: MediaSnapshot) { return Response.json({ replayed: false, snapshot: value }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Immediate player controls and ordered worker acknowledgments', () => {
  it('keeps partial continuation feedback while confirming successful playback', async () => {
    const initial = snapshot(); const changed = structuredClone(initial); changed.session!.currentTrack = changed.session!.queue[0]!; changed.session!.queueVersion++;
    const warning = 'Вибраний трек запущено. Частину добірки не додано; повторіть пошук, щоб оновити її.';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: changed, warning } : initial)));
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    await act(async () => result.current.send({ type: 'PLAY_TRACK', provider: 'direct', providerItemId: changed.session!.currentTrack!.providerItemId }, changed.session!.currentTrack!));
    expect(result.current.snapshot.session?.currentTrack?.title).toBe('second'); expect(result.current.pending).toHaveLength(0);
    expect(result.current.message).toBe(warning); expect(result.current.transient).toBe(false); expect(result.current.unavailable).toBeNull();
  });
  it('keeps only the newest unstarted selection during rapid track clicks', async () => {
    const initial = snapshot(), first = deferred(); let post = 0;
    const second = initial.session!.queue[0]!, third = initial.session!.queue[1]!;
    const latest = { ...third, providerItemId: 'https://audio.example/latest.mp3', title: 'latest' };
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(Response.json(initial));
      if (++post === 1) return first.promise;
      const result = structuredClone(initial); result.session!.currentTrack = latest; result.session!.queueVersion = 4;
      return Promise.resolve(ack(result));
    });
    vi.stubGlobal('fetch', fetch); const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    act(() => { for (const track of [second, third, latest]) result.current.send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track); });
    expect(result.current.pending).toHaveLength(2); expect(result.current.snapshot.session?.currentTrack?.title).toBe('current');
    const changed = structuredClone(initial); changed.session!.currentTrack = second; changed.session!.queueVersion = 3;
    await act(async () => first.resolve(ack(changed)));
    expect(result.current.snapshot.session?.currentTrack?.title).toBe('latest');
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)));
    expect(posts.map((command) => command.action.providerItemId)).toEqual([second.providerItemId, latest.providerItemId]);
    expect(posts.map((command) => command.expectedQueueVersion)).toEqual([2, 3]);
  });
  it('continues with a newer selection when preparing the first track is rejected', async () => {
    const initial = snapshot(), first = deferred(); let post = 0;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(Response.json(initial));
      if (++post === 1) return first.promise;
      const updated = structuredClone(initial); updated.session!.currentTrack = initial.session!.queue[1]!; updated.session!.queueVersion++;
      return Promise.resolve(ack(updated));
    });
    vi.stubGlobal('fetch', fetch); const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    act(() => { for (const track of initial.session!.queue) result.current.send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track); });
    await act(async () => first.resolve(Response.json({ error: 'Аудіо недоступне.' }, { status: 422 })));
    expect(post).toBe(2); expect(result.current.pending).toHaveLength(0); expect(result.current.snapshot.session?.currentTrack?.title).toBe('third');
    expect(result.current.message).toBe('');
  });
  it('cancels an unstarted alternate selection when the user chooses the in-flight track again', async () => {
    const initial = snapshot(), command = deferred();
    const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? command.promise : Promise.resolve(Response.json(initial)));
    vi.stubGlobal('fetch', fetch); const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    const second = initial.session!.queue[0]!, third = initial.session!.queue[1]!;
    act(() => { for (const track of [second, third, second]) result.current.send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track); });
    expect(result.current.pending).toHaveLength(1);
    const updated = structuredClone(initial); updated.session!.currentTrack = second; updated.session!.queueVersion++;
    await act(async () => command.resolve(ack(updated)));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(result.current.snapshot.session?.currentTrack?.title).toBe('second');
  });
  it.each(['playing', 'paused'] as const)('previews seeking in %s state and rolls back a rejected position', async (state) => {
    const initial = snapshot(), command = deferred(); initial.session!.state = state;
    if (state === 'paused') initial.session!.pausedAt = Date.now();
    const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? command.promise : Promise.resolve(Response.json(initial)));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    act(() => result.current.send({ type: 'SEEK', queueItemId: ids[0]!, positionMs: 60000 }));
    expect(result.current.snapshot.session).toMatchObject({ state, playbackOffsetMs: 60000, accumulatedPauseMs: 0 });
    if (state === 'paused') expect(result.current.snapshot.session?.pausedAt).toBe(result.current.snapshot.session?.startedAt);
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ sessionId: ids[0], expectedQueueVersion: 2, action: { type: 'SEEK', queueItemId: ids[0], positionMs: 60000 } });
    await act(async () => command.resolve(Response.json({ error: 'Перемотування недоступне.' }, { status: 422 })));
    expect(result.current.snapshot.session).toEqual(initial.session); expect(result.current.message).toBe('Перемотування недоступне.'); expect(result.current.pending).toHaveLength(0);
  });
  it('does not retry a stale seek on a newer track', async () => {
    const initial = snapshot(), fresh = structuredClone(initial); fresh.session!.currentTrack = fresh.session!.queue[0]!; fresh.session!.queueVersion++;
    let get = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ error: 'Черга змінилася.' }, { status: 409 }) : Response.json(++get === 1 ? initial : fresh));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    await act(async () => result.current.send({ type: 'SEEK', queueItemId: ids[0]!, positionMs: 60000 }));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1); expect(result.current.snapshot.session?.currentTrack?.title).toBe('second');
  });
  it('reconciles a stale track selection once and preserves subsequent rapid selections in order', async () => {
    const initial = snapshot(), first = deferred(); const fresh = structuredClone(initial); fresh.session!.queueVersion = 3;
    let post = 0, get = 0;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(Response.json(++get === 1 ? initial : fresh));
      if (++post === 1) return first.promise;
      const selected = JSON.parse(String(init.body)).action.providerItemId;
      const updated = structuredClone(fresh); updated.session!.currentTrack = initial.session!.queue.find((item) => item.providerItemId === selected)!;
      updated.session!.queueVersion = post + 2; return Promise.resolve(ack(updated));
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    act(() => { for (const track of initial.session!.queue) result.current.send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track); });
    await act(async () => first.resolve(Response.json({ error: 'Черга змінилася.' }, { status: 409 })));
    expect(result.current.pending).toHaveLength(0); expect(result.current.message).toBe(''); expect(result.current.snapshot.session?.currentTrack?.title).toBe('third');
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)));
    expect(posts.map((command) => command.expectedQueueVersion)).toEqual([2, 3, 4]);
    expect(posts[0].commandId).toBe(posts[1].commandId); expect(posts[2].commandId).not.toBe(posts[1].commandId);
  });
  it.each(['unchanged', 'new-session', 'second-conflict', 'timeout'])('does not repeat an unsafe or repeatedly rejected selection (%s)', async (failure) => {
    const initial = snapshot(); const fresh = structuredClone(initial);
    if (failure !== 'unchanged') fresh.session!.queueVersion++;
    if (failure === 'new-session') fresh.session!.sessionId = ids[1]!;
    let get = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({ error: 'Дію відхилено.' }, { status: failure === 'timeout' ? 503 : 409 })
      : Response.json(++get === 1 ? initial : fresh));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    const track = initial.session!.queue[0]!;
    await act(async () => result.current.send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(failure === 'second-conflict' ? 2 : 1);
    expect(result.current.pending).toHaveLength(0); expect(result.current.message).toContain('Дію відхилено.');
  });
  it('silently acknowledges ordinary controls and auto-dismisses add feedback without hiding errors', async () => {
    vi.useFakeTimers(); const initial = snapshot();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? ack(initial) : Response.json(initial));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    await act(async () => result.current.send({ type: 'SET_VOLUME', volume: 50 })); expect(result.current.message).toBe('');
    await act(async () => result.current.send({ type: 'ADD_TRACK', provider: 'youtube', providerItemId: 'hmzIgMhbefo' }));
    expect(result.current.message).toBe('Трек додано до черги.'); expect(result.current.transient).toBe(true);
    act(() => vi.advanceTimersByTime(3200)); expect(result.current.message).toBe('');
    act(() => result.current.setMessage('Недостатньо прав.')); act(() => vi.advanceTimersByTime(4000));
    expect(result.current.message).toBe('Недостатньо прав.'); expect(result.current.transient).toBe(false);
  });
  it('keeps skipped/current tracks in the optimistic retained list while moving to the next track', async () => {
    const initial = snapshot(), command = deferred();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? command.promise : Promise.resolve(Response.json(initial))));
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    act(() => result.current.send({ type: 'SKIP' }));
    expect(result.current.snapshot.session?.currentTrack?.title).toBe('second'); expect(result.current.snapshot.session?.played.map((item) => item.title)).toEqual(['current']);
    act(() => result.current.send({ type: 'STOP' }));
    expect(result.current.snapshot.session?.currentTrack).toBeNull(); expect(result.current.snapshot.session?.played.map((item) => item.title)).toEqual(['current', 'second']);
  });
  it('updates pause/resume before the worker responds, accepts the next click and avoids extra state requests', async () => {
    const initial = snapshot(), first = deferred(), second = deferred(); let post = 0;
    const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? (++post === 1 ? first.promise : second.promise) : Promise.resolve(Response.json(initial)));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => result.current.send({ type: 'PAUSE' }));
    expect(result.current.snapshot.session?.state).toBe('paused');
    act(() => result.current.send({ type: 'RESUME' }));
    expect(result.current.snapshot.session?.state).toBe('playing'); expect(result.current.pending).toHaveLength(2);
    expect(post).toBe(1);
    const paused = structuredClone(initial); paused.session!.state = 'paused'; paused.session!.pausedAt = Date.now(); paused.session!.queueVersion = 3;
    await act(async () => first.resolve(ack(paused)));
    expect(post).toBe(2); expect(result.current.snapshot.session?.state).toBe('playing');
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(posts[1]![1]!.body))).toMatchObject({ expectedQueueVersion: 3, action: { type: 'RESUME' } });
    const playing = structuredClone(paused); playing.session!.state = 'playing'; playing.session!.pausedAt = null;
    await act(async () => second.resolve(ack(playing)));
    expect(result.current.pending).toHaveLength(0); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('removes and reorders immediately while dispatching subsequent edits with the acknowledged queue version', async () => {
    const initial = snapshot(), first = deferred(), second = deferred(); let post = 0;
    const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? (++post === 1 ? first.promise : second.promise) : Promise.resolve(Response.json(initial)));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null));
    await act(async () => {});
    act(() => result.current.send({ type: 'MOVE_QUEUE_ITEM', queueItemId: ids[2]!, position: 0, expectedQueueVersion: 2 }));
    expect(result.current.snapshot.session?.queue.map((item) => item.title)).toEqual(['third', 'second']);
    act(() => result.current.send({ type: 'REMOVE_QUEUE_ITEM', queueItemId: ids[1]!, expectedQueueVersion: 2 }));
    expect(result.current.snapshot.session?.queue.map((item) => item.title)).toEqual(['third']);
    const moved = structuredClone(initial); moved.session!.queue.reverse(); moved.session!.queueVersion = 3;
    await act(async () => first.resolve(ack(moved)));
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(posts[1]![1]!.body))).toMatchObject({ expectedQueueVersion: 3, action: { type: 'REMOVE_QUEUE_ITEM', expectedQueueVersion: 3 } });
    const removed = structuredClone(moved); removed.session!.queue = removed.session!.queue.filter((item) => item.queueItemId !== ids[1]); removed.session!.queueVersion = 4;
    await act(async () => second.resolve(ack(removed)));
    expect(result.current.snapshot.session?.queueVersion).toBe(4); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('rolls back rejected optimistic changes, cancels dependent clicks and reconciles before accepting a new command', async () => {
    const initial = snapshot(), first = deferred(), reconciliation = deferred(), next = deferred(); let get = 0;
    const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? first.promise : ++get === 1 ? Promise.resolve(Response.json(initial)) : reconciliation.promise);
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
    act(() => { result.current.send({ type: 'PAUSE' }); result.current.send({ type: 'SET_VOLUME', volume: 20 }); });
    await act(async () => first.resolve(Response.json({ error: 'Недостатньо прав.' }, { status: 403 })));
    expect(result.current.snapshot.session?.state).toBe('playing'); expect(result.current.snapshot.session?.volume).toBe(60);
    expect(result.current.message).toContain('Наступні дії скасовано');
    act(() => result.current.send({ type: 'SET_VOLUME', volume: 40 }));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    fetch.mockImplementation((_url: string, init?: RequestInit) => init?.method === 'POST' ? next.promise : Promise.resolve(Response.json(initial)));
    const fresh = structuredClone(initial); fresh.session!.queueVersion = 9;
    await act(async () => reconciliation.resolve(Response.json(fresh)));
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(2); expect(JSON.parse(String(posts[1]![1]!.body))).toMatchObject({ expectedQueueVersion: 9, action: { type: 'SET_VOLUME', volume: 40 } });
    fresh.session!.volume = 40; await act(async () => next.resolve(ack(fresh)));
    expect(result.current.snapshot.session?.volume).toBe(40);
  });
  it.each([false, true])('ignores an older polling response or failure after a command acknowledgment (failure=%s)', async (failure) => {
    const initial = snapshot(), poll = deferred(), command = deferred();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? command.promise : poll.promise));
    const { result } = renderHook(() => useMediaController(guildId, initial, null));
    act(() => result.current.send({ type: 'PAUSE' }));
    const paused = structuredClone(initial); paused.session!.state = 'paused'; paused.session!.pausedAt = Date.now();
    await act(async () => command.resolve(ack(paused)));
    await act(async () => poll.resolve(failure ? Response.json({ error: 'Old outage' }, { status: 503 }) : Response.json(initial)));
    expect(result.current.snapshot.session?.state).toBe('paused'); expect(result.current.unavailable).toBeNull();
  });
});

it('replaces an unsent selection while reconciling a rejected source', async () => {
 const initial = snapshot(), first = deferred(), reconciliation = deferred(); let reads = 0;
 const second = initial.session!.queue[0]!, third = initial.session!.queue[1]!, current = initial.session!.currentTrack!;
 const actions: string[] = [];
 vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
   if (init?.method !== 'POST') return ++reads === 1 ? Promise.resolve(Response.json(initial)) : reconciliation.promise;
   const action = JSON.parse(String(init.body)).action; actions.push(action.providerItemId);
   return actions.length === 1 ? first.promise : Promise.resolve(ack(initial));
 }));
 const { result } = renderHook(() => useMediaController(guildId, initial, null)); await act(async () => {});
 act(() => { for (const track of [second, third]) result.current.send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track); });
 await act(async () => first.resolve(Response.json({ error: 'Unavailable' }, { status: 422 })));
 act(() => result.current.send({ type: 'PLAY_TRACK', provider: current.provider, providerItemId: current.providerItemId }, current));
 await act(async () => reconciliation.resolve(Response.json(initial)));
 expect(actions).toEqual([second.providerItemId, current.providerItemId]); expect(result.current.pending).toHaveLength(0);
});
