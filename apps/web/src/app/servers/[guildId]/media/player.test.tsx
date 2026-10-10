// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mediaSettingsSchema, mediaSnapshotSchema } from '@scrt/validation';
import { MediaPlayerClient } from './player';

const guildId = '12345678901234567';
const query = 'https://music.youtube.com/watch?v=hmzIgMhbefo&si=share';
function snapshot(configured = false) {
  return mediaSnapshotSchema.parse({
    session: null, settings: mediaSettingsSchema.parse({ enabled: true }), controls: { ADD_TRACK: true, PLAY_TRACK: true }, queueControls: {},
    actorVoice: { id: '22345678901234567', name: 'Gaming' }, remoteControl: false, listenerCount: 0,
    votes: { count: 0, required: 1 }, engine: { available: true, ffmpeg: true, opus: true, dave: true }, serverTimestamp: Date.now(), canManage: true,
    providers: [{ id: 'youtube', name: 'YouTube', state: configured ? 'available' : 'unconfigured', capabilities: { search: true, metadata: true, playback: false, live: false, seek: false, playlists: false } }],
  });
}
beforeEach(() => {
  vi.stubGlobal('React', React); sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function search(response: { results: unknown[]; unavailable: string[]; errors?: string[] }, configured = false) {
  const initial = snapshot(configured);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') throw new Error('Unexpected media mutation');
    return Response.json(url.includes('?q=') ? response : initial);
  });
  vi.stubGlobal('fetch', fetch);
  render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={initial} initialError={null} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Знайти' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('?q='))).toBe(true));
  return fetch;
}

describe('Media catalog search feedback', () => {
  it('shows the confirmed track and progress until a requested replacement is acknowledged', async () => {
    const initial = snapshot(true);
    const current = { provider: 'youtube' as const, providerItemId: 'G63iPGvgGYs', title: 'Confirmed track', artist: 'Artist', type: 'track' as const, durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=G63iPGvgGYs', playable: true, seekable: true, explicit: null, queueItemId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c1', requestedByUserId: guildId, requestedByName: 'Listener', requestedAt: 1 };
    const selected = { ...current, providerItemId: 'TwumA6YhQp4', title: 'Requested track', queueItemId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c2' };
    const playing = mediaSnapshotSchema.parse({ ...initial, controls: { PLAY_TRACK: true, PAUSE: true, SEEK: true }, session: { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id, voiceChannelName: 'Gaming', state: 'playing', currentTrack: current, queue: [selected], played: [], startedAt: Date.now() - 30000, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null } });
    let acknowledge!: (value: Response) => void; const command = new Promise<Response>((resolve) => { acknowledge = resolve; });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? command : Promise.resolve(Response.json(playing))));
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={playing} initialError={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Відтворити з черги: Requested track' }));
    const player = within(screen.getByRole('region', { name: 'Плеєр' }));
    expect(player.getByRole('heading', { name: current.title })).toBeTruthy(); expect(player.queryByRole('heading', { name: selected.title })).toBeNull();
    expect(player.getByText(/Перемикаємо на/)).toBeTruthy();
    expect(Number(player.getByRole('progressbar', { name: 'Прогрес відтворення' }).getAttribute('value'))).toBeGreaterThan(20000);
    expect(player.getByRole('button', { name: 'Призупинити відтворення' }).hasAttribute('disabled')).toBe(true);
    const changed = structuredClone(playing); changed.session!.currentTrack = selected; changed.session!.queue = []; changed.session!.startedAt = Date.now(); changed.session!.queueVersion++;
    acknowledge(Response.json({ replayed: false, snapshot: changed }));
    await player.findByRole('heading', { name: selected.title });
    expect(player.queryByText(/Перемикаємо на/)).toBeNull(); expect(player.queryByRole('heading', { name: current.title })).toBeNull();
  });
  it('replaces the idle heading cleanly when a track starts and returns to idle without duplicate React keys', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const initial = snapshot(true); const current = { provider: 'youtube' as const, providerItemId: 'G63iPGvgGYs', title: 'Selected track', artist: 'Artist', type: 'track' as const, durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=G63iPGvgGYs', playable: true, seekable: true, explicit: null, queueItemId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c1', requestedByUserId: guildId, requestedByName: 'Listener', requestedAt: 1 };
      const playing = mediaSnapshotSchema.parse({ ...initial, controls: { STOP: true }, session: { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id, voiceChannelName: 'Gaming', state: 'playing', currentTrack: current, queue: [], played: [], startedAt: Date.now(), pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null } });
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: initial } : playing)));
      render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={initial} initialError={null} />);
      const player = within(screen.getByRole('region', { name: 'Плеєр' }));
      expect(player.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      await player.findByRole('heading', { name: current.title });
      expect(player.queryByRole('heading', { name: 'Що слухаємо сьогодні?' })).toBeNull();
      expect(player.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      fireEvent.click(player.getByRole('button', { name: 'Зупинити сесію' }));
      fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));
      await player.findByRole('heading', { name: 'Що слухаємо сьогодні?' });
      expect(player.queryByRole('heading', { name: current.title })).toBeNull();
      expect(player.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      expect(errors.mock.calls.some((args) => String(args[0]).includes('same key'))).toBe(false);
    } finally { errors.mockRestore(); }
  });
  it('submits the slider position with the current queue identity and exposes read-only progress for unsupported audio', async () => {
    const initial = snapshot(true); const queueItemId = 'e1f2d646-c71b-447e-8f8b-1d537d3b17c1';
    const current = { provider: 'youtube', providerItemId: 'TwumA6YhQp4', title: 'Current', artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://youtu.be/TwumA6YhQp4', playable: true, seekable: true, explicit: null, queueItemId, requestedByUserId: guildId, requestedByName: 'Listener', requestedAt: 1 };
    const value = mediaSnapshotSchema.parse({ ...initial, controls: { ...initial.controls, SEEK: true }, session: { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id, voiceChannelName: 'Gaming', state: 'playing', currentTrack: current, queue: [], played: [], startedAt: Date.now(), pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null } });
    const seeked = structuredClone(value); seeked.session!.playbackOffsetMs = 60000; seeked.session!.queueVersion++;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: seeked } : value));
    vi.stubGlobal('fetch', fetch);
    const { unmount } = render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={value} initialError={null} />);
    const slider = screen.getByRole('slider', { name: 'Перемотати трек' });
    fireEvent.change(slider, { target: { value: '60000' } }); fireEvent.pointerUp(slider);
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ expectedQueueVersion: 2, action: { type: 'SEEK', queueItemId, positionMs: 60000 } });
    unmount(); value.session!.currentTrack!.seekable = false; value.controls.SEEK = false;
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={value} initialError={null} />);
    expect(screen.queryByRole('slider', { name: 'Перемотати трек' })).toBeNull(); expect(screen.getByRole('progressbar')).toBeTruthy();
  });
  it('offers explicit recovery in the manager current Voice after the original channel was deleted', async () => {
    const initial = snapshot(true);
    initial.controls = { RESTORE: true, ADD_TRACK: false, MOVE_SESSION: true };
    initial.session = { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: '32345678901234567', voiceChannelName: 'Deleted room', state: 'idle', currentTrack: null, queue: [], played: [], startedAt: null, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: true, lastError: 'Голосовий канал видалено. Чергу збережено.', lastRequesterId: null };
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: initial } : initial));
    vi.stubGlobal('fetch', fetch);
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={initial} initialError={null} />);
    expect(screen.getByText('Натисніть «Відновити тут», щоб запустити збережену чергу у Gaming.')).toBeTruthy();
    expect(screen.queryByText(/SCRT відтворює музику в/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перемістити SCRT сюди' })).toBeNull();
    const restore = screen.getByRole('button', { name: 'Відновити тут' });
    expect(restore.hasAttribute('disabled')).toBe(false);
    fireEvent.click(restore);
    await waitFor(() => expect(screen.queryByText(/Синхронізація ·/)).toBeNull());
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]?.body))).toMatchObject({ sessionId: initial.session.sessionId, expectedQueueVersion: 2, action: { type: 'RESTORE' } });
  });
  it('labels a queued track correctly when a restart requires explicit session recovery', async () => {
    const initial = snapshot(true);
    initial.controls.RESTORE = true;
    initial.session = { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id!, voiceChannelName: 'Gaming', state: 'idle', currentTrack: null, queue: [], played: [], startedAt: null, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 1, revision: 1, createdAt: 1, updatedAt: 1, recoverable: true, lastError: 'Відтворення було перервано перезапуском SCRT.', lastRequesterId: null };
    const track = { provider: 'soundcloud', providerItemId: 'https://soundcloud.com/artist/track', title: 'Playable Track', artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://soundcloud.com/artist/track', playable: true, seekable: false, explicit: null };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: initial } : url.includes('?q=') ? { results: [track], unavailable: [] } : initial));
    vi.stubGlobal('fetch', fetch);
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={initial} initialError={null} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: track.externalUrl } });
    fireEvent.click(screen.getByRole('button', { name: 'Знайти' }));
    const button = await screen.findByRole('button', { name: /^Додати до черги:/ });
    expect(screen.getByRole('button', { name: 'Відтворити: Playable Track' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByText('Трек додано до збереженої черги. Натисніть «Відновити», щоб запустити сесію.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Відновити' }).hasAttribute('disabled')).toBe(false);
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1); expect(JSON.parse(String(posts[0]![1]?.body)).action).toEqual({ type: 'ADD_TRACK', provider: 'soundcloud', providerItemId: track.providerItemId });
  });
  it('explains unconfigured YouTube search instead of claiming that the track was not found', async () => {
    await search({ results: [], unavailable: ['YouTube'] });
    expect(await screen.findByText(/Не налаштовано пошук: YouTube/)).toBeTruthy();
    expect(screen.queryByText(/Нічого не знайдено/)).toBeNull();
    expect(screen.getByText(/Spotify надає лише інформацію/)).toBeTruthy();
  });
  it('distinguishes a configured catalog outage from missing configuration', async () => {
    await search({ results: [], unavailable: ['YouTube'] }, true);
    expect(await screen.findByText('Тимчасово недоступні джерела: YouTube.')).toBeTruthy();
    expect(screen.queryByText(/Не налаштовано пошук/)).toBeNull();
  });
  it('shows metadata results as external links and never submits a playback command for them', async () => {
    const fetch = await search({ results: [{ provider: 'youtube', providerItemId: 'hmzIgMhbefo', title: 'Track', artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=hmzIgMhbefo', playable: false, seekable: false, explicit: null }], unavailable: [] }, true);
    const link = await screen.findByRole('link', { name: 'Відкрити у youtube' });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=hmzIgMhbefo');
    expect(screen.queryByRole('button', { name: /^Відтворити:/ })).toBeNull();
    expect(fetch.mock.calls.every(([url]) => url.startsWith(`/api/guilds/${guildId}/media`))).toBe(true);
    expect(fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });
  it.each(['youtube', 'soundcloud'])('offers playback for resolved %s audio without treating it as metadata-only', async (provider) => {
    await search({ results: [{ provider, providerItemId: provider === 'youtube' ? 'TwumA6YhQp4' : 'https://soundcloud.com/artist/track', title: 'Playable Track', artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: provider === 'youtube' ? 'https://www.youtube.com/watch?v=TwumA6YhQp4' : 'https://soundcloud.com/artist/track', playable: true, seekable: false, explicit: null }], unavailable: [] }, true);
    const button = await screen.findByRole('button', { name: 'Відтворити: Playable Track' });
    expect(button.hasAttribute('disabled')).toBe(false); expect(screen.queryByRole('link', { name: `Відкрити у ${provider}` })).toBeNull();
  });
  it('plays a search result from its cover and retains a separate add-to-queue action', async () => {
    const initial = snapshot(true);
    const track = { provider: 'youtube', providerItemId: 'TwumA6YhQp4', title: 'Cover Track', artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=TwumA6YhQp4', playable: true, seekable: false, explicit: null };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: initial } : url.includes('?q=') ? { results: [track], unavailable: [] } : initial));
    vi.stubGlobal('fetch', fetch);
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={initial} initialError={null} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: track.externalUrl } });
    fireEvent.click(screen.getByRole('button', { name: 'Знайти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Відтворити: Cover Track' }));
    await waitFor(() => expect(screen.queryByText(/Синхронізація ·/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Додати до черги:/ }));
    await screen.findByText('Трек додано до черги.');
    const actions = fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)).action);
    expect(actions).toEqual([{ type: 'PLAY_TRACK', provider: 'youtube', providerItemId: track.providerItemId }, { type: 'ADD_TRACK', provider: 'youtube', providerItemId: track.providerItemId }]);
  });
  it('shows provider access refusals as returned by the bot', async () => {
    await search({ results: [], unavailable: ['YouTube'], errors: ['YouTube вимагає авторизації для цього запиту.'] }, true);
    expect(await screen.findByText('YouTube вимагає авторизації для цього запиту.')).toBeTruthy();
    expect(screen.queryByText(/Тимчасово недоступні джерела/)).toBeNull();
  });
  it('starts from the selected search result and passes following playable results in displayed order', async () => {
    const initial = snapshot(true);
    const tracks = ['Earlier', 'Selected', 'Metadata', 'Next'].map((title, index) => ({ provider: 'youtube', providerItemId: `video-id-${index}`, title, artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=TwumA6YhQp4', playable: index !== 2, seekable: false, explicit: null }));
    const fetch = vi.fn(async (url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: initial } : url.includes('?q=') ? { results: tracks, unavailable: [] } : initial));
    vi.stubGlobal('fetch', fetch);
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={initial} initialError={null} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Songs' } }); fireEvent.click(screen.getByRole('button', { name: 'Знайти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Відтворити: Selected' }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body)).action).toEqual({ type: 'PLAY_TRACK', provider: 'youtube', providerItemId: 'video-id-1', following: [{ provider: 'youtube', providerItemId: 'video-id-3' }] });
    expect(screen.queryByText('Зміни застосовано.')).toBeNull();
  });
  it('keeps the current row visible and lets users expand played tracks with authorized controls', async () => {
    const initial = snapshot(true); initial.controls.PAUSE = true;
    const item = (title: string, id: string) => ({ provider: 'youtube', providerItemId: 'TwumA6YhQp4', title, artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=TwumA6YhQp4', playable: true, seekable: false, explicit: null, queueItemId: id, requestedByUserId: guildId, requestedByName: 'Listener', requestedAt: 1 });
    const played = item('Played', 'e1f2d646-c71b-447e-8f8b-1d537d3b17c1'), current = item('Current', 'e1f2d646-c71b-447e-8f8b-1d537d3b17c2');
    current.providerItemId = 'hmzIgMhbefo';
    const value = mediaSnapshotSchema.parse({ ...initial, session: { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id, voiceChannelName: 'Gaming', state: 'playing', currentTrack: current, queue: [], played: [played], startedAt: 1, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null }, queueControls: { [played.queueItemId]: { move: false, remove: false } } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={value} initialError={null} />);
    expect(screen.getByRole('list', { name: 'Поточний трек' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Зіграні треки' }).closest('details')?.open).toBe(false);
    fireEvent.click(screen.getByText('Зіграні'));
    expect(screen.getByRole('list', { name: 'Зіграні треки' }).closest('details')?.open).toBe(true);
    expect(screen.getByRole('button', { name: 'Повторити: Played' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Видалити: Played' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Тут буде твоя добірка')).toBeNull();
  });
  it('filters queue titles and requesters while retaining original positions and move boundaries', async () => {
    const initial = snapshot(true);
    const queue = ['First', 'Middle', 'Last'].map((title, index) => ({ provider: 'youtube', providerItemId: `video-${index}`, title, artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=TwumA6YhQp4', playable: true, seekable: true, explicit: null, queueItemId: `e1f2d646-c71b-447e-8f8b-1d537d3b17c${index + 1}`, requestedByUserId: guildId, requestedByName: index === 1 ? 'Special Listener' : 'Listener', requestedAt: 1 }));
    const value = mediaSnapshotSchema.parse({ ...initial, session: { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id, voiceChannelName: 'Gaming', state: 'idle', currentTrack: null, queue, played: [], startedAt: null, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null }, queueControls: Object.fromEntries(queue.map((item) => [item.queueItemId, { move: true, remove: true }])) });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { replayed: false, snapshot: value } : value)); vi.stubGlobal('fetch', fetch);
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={value} initialError={null} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Фільтр черги та зіграних треків' }), { target: { value: 'special' } });
    const list = screen.getByRole('list', { name: 'Наступні треки' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('2')).toBeTruthy(); expect(within(list).getByRole('listitem').draggable).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Перемістити нижче: Middle' }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body))).toMatchObject({ action: { type: 'MOVE_QUEUE_ITEM', queueItemId: queue[1]!.queueItemId, position: 2, expectedQueueVersion: 2 } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Фільтр черги та зіграних треків' }), { target: { value: 'Last' } });
    expect(screen.getByRole('button', { name: 'Перемістити нижче: Last' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Очистити фільтр черги' }));
    expect(within(screen.getByRole('list', { name: 'Наступні треки' })).getAllByRole('listitem')).toHaveLength(3);
  });
});

it.each(['requested', 'current'])('honors the last %s selection through actual queue buttons', async (last) => {
    const initial = snapshot(true);
    const current = { provider: 'youtube' as const, providerItemId: 'G63iPGvgGYs', title: 'Confirmed track', artist: 'Artist', type: 'track' as const, durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=G63iPGvgGYs', playable: true, seekable: true, explicit: null, queueItemId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c1', requestedByUserId: guildId, requestedByName: 'Listener', requestedAt: 1 };
    const selected = { ...current, providerItemId: 'TwumA6YhQp4', title: 'Requested track', queueItemId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c2' };
    const playing = mediaSnapshotSchema.parse({ ...initial, controls: { PLAY_TRACK: true, PAUSE: true, SEEK: true }, session: { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id, voiceChannelName: 'Gaming', state: 'playing', currentTrack: current, queue: [selected], played: [], startedAt: Date.now() - 30000, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null } });

 const alternate = { ...selected, title: 'Alternate', providerItemId: 'hmzIgMhbefo', queueItemId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c3' }; playing.session!.queue.push(alternate);
 let resolve!: (value: Response) => void; const first = new Promise<Response>((done) => { resolve = done; });
 const actions: { type: string; providerItemId?: string }[] = [];
 vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
   if (init?.method !== 'POST') return Promise.resolve(Response.json(playing));
   actions.push(JSON.parse(String(init.body)).action);
   if (actions.length === 1) return first;
   const changed = structuredClone(playing); changed.session!.queueVersion += 2;
   return Promise.resolve(Response.json({ snapshot: changed, replayed: false }));
 }));
 render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={playing} initialError={null} />);
 fireEvent.click(screen.getByRole('button', { name: 'Відтворити з черги: Requested track' }));
 fireEvent.click(screen.getByRole('button', { name: 'Відтворити з черги: Alternate' }));
 const button = last === 'requested' ? screen.getByRole('button', { name: 'Відтворити з черги: Requested track' }) : within(screen.getByRole('list', { name: 'Поточний трек' })).getByRole('button');
 expect(button.hasAttribute('disabled')).toBe(false); fireEvent.click(button);
 const changed = structuredClone(playing); changed.session!.currentTrack = selected; changed.session!.queue = [alternate]; changed.session!.played = [current]; changed.session!.queueVersion++;
 resolve(Response.json({ snapshot: changed, replayed: false }));
 await waitFor(() => expect(screen.queryByText(/Синхронізація ·/)).toBeNull());
 expect(actions).toEqual((last === 'requested' ? [selected] : [selected, current]).map((track) => ({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId })));
 expect(within(screen.getByRole('region', { name: 'Плеєр' })).getByRole('heading', { name: last === 'requested' ? selected.title : current.title })).toBeTruthy();
});
