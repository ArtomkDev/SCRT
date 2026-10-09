// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
beforeEach(() => { vi.stubGlobal('React', React); sessionStorage.clear(); });
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
  it('keeps the current and played rows visible with replay and authorized removal controls', async () => {
    const initial = snapshot(true); initial.controls.PAUSE = true;
    const item = (title: string, id: string) => ({ provider: 'youtube', providerItemId: 'TwumA6YhQp4', title, artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://www.youtube.com/watch?v=TwumA6YhQp4', playable: true, seekable: false, explicit: null, queueItemId: id, requestedByUserId: guildId, requestedByName: 'Listener', requestedAt: 1 });
    const played = item('Played', 'e1f2d646-c71b-447e-8f8b-1d537d3b17c1'), current = item('Current', 'e1f2d646-c71b-447e-8f8b-1d537d3b17c2');
    current.providerItemId = 'hmzIgMhbefo';
    const value = mediaSnapshotSchema.parse({ ...initial, session: { sessionId: 'e1f2d646-c71b-447e-8f8b-1d537d3b17c0', guildId, voiceChannelId: initial.actorVoice.id, voiceChannelName: 'Gaming', state: 'playing', currentTrack: current, queue: [], played: [played], startedAt: 1, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: guildId, queueVersion: 2, revision: 2, createdAt: 1, updatedAt: 2, recoverable: false, lastError: null, lastRequesterId: null }, queueControls: { [played.queueItemId]: { move: false, remove: false } } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
    render(<MediaPlayerClient guildId={guildId} userId="42345678901234567" initial={value} initialError={null} />);
    expect(screen.getByRole('list', { name: 'Поточний трек' })).toBeTruthy(); expect(screen.getByRole('list', { name: 'Зіграні треки' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторити: Played' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Видалити: Played' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Тут буде твоя добірка')).toBeNull();
  });
});
