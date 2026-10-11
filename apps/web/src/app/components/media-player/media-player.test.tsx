// @vitest-environment jsdom
import * as React from 'react';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mediaSettingsSchema, mediaSnapshotSchema, type MediaSnapshot } from '@scrt/validation';
import { DashboardMediaProvider, MediaGuildRegistration, useWorkspaceMediaController, type MediaPlayerScope } from './media-player-context';
import { MediaPlayerButton, MediaPlayerHeaderGlow } from './media-player-dock';
import { RuntimeLogsButton, RuntimeLogsProvider, RuntimeLogsWorkspace } from '../runtime-logs/runtime-logs-panel';
import { MediaHistoryClient } from '@/app/servers/[guildId]/media/history/history';
import { MediaHeader } from '@/app/servers/[guildId]/media/media-header';
import { MediaPlayerClient } from '@/app/servers/[guildId]/media/player';
import { useMediaFavorites } from '@/app/servers/[guildId]/media/favorites-context';
vi.mock('next/navigation', () => ({ usePathname: () => '/servers/12345678901234567/media/history' }));

const guildId = '12345678901234567', userId = '22345678901234567';
const song = { provider: 'soundcloud' as const, providerItemId: 'https://soundcloud.com/artist/song', title: 'Current song', artist: 'Artist', durationMs: 180000, type: 'track' as const, artworkUrl: null, externalUrl: 'https://soundcloud.com/artist/song', playable: true, seekable: true, explicit: null, queueItemId: '00000000-0000-4000-8000-000000000001', requestedByUserId: userId, requestedByName: 'Listener', requestedAt: 1 };
const historySong = { ...song, title: 'History song', providerItemId: 'https://soundcloud.com/artist/history', externalUrl: 'https://soundcloud.com/artist/history', queueItemId: '00000000-0000-4000-8000-000000000003' };
function initial(id = guildId): MediaSnapshot {
  return mediaSnapshotSchema.parse({ settings: mediaSettingsSchema.parse({ enabled: true }), controls: { PAUSE: true, RESUME: true, PLAY_TRACK: true, ADD_TRACK: true, SEEK: true, SET_VOLUME: true }, queueControls: {}, actorVoice: { id: userId, name: 'Voice' }, remoteControl: false, listenerCount: 1, votes: { count: 0, required: 1 }, providers: [], engine: { available: true, ffmpeg: true, opus: true, dave: true }, canManage: true, serverTimestamp: 10000,
    session: { sessionId: '00000000-0000-4000-8000-000000000002', guildId: id, voiceChannelId: userId, voiceChannelName: 'Voice', state: 'playing', currentTrack: song, queue: [], played: [], startedAt: 1, pausedAt: null, accumulatedPauseMs: 0, volume: 50, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: userId, queueVersion: 1, revision: 1, createdAt: 1, updatedAt: 1, recoverable: false, lastError: null, lastRequesterId: userId } });
}
function scope(id = guildId): MediaPlayerScope { return { guildId: id, userId, guildName: id === guildId ? 'First server' : 'Second server', initial: initial(id), initialError: null, allowYoutube: false }; }
const logState = { web: { runId: 'web', startedAt: '2026-10-11T10:00:00Z', dropped: 0, entries: [] }, bot: null, botError: null };
function App({ selected = scope(), startPage = 'history' }: { selected?: MediaPlayerScope; startPage?: 'history' | 'search' }) {
  const [page, setPage] = useState<string>(startPage);
  const [registration, setRegistration] = useState<MediaPlayerScope | null>(selected);
  return <RuntimeLogsProvider><DashboardMediaProvider initialScope={selected}>
    <MediaPlayerHeaderGlow /><MediaPlayerButton /><RuntimeLogsButton />
    <RuntimeLogsWorkspace><MediaGuildRegistration scope={registration} />
      <MediaHeader guildId={guildId} /><button onClick={() => setPage('settings')}>Інший екран</button><button onClick={() => setRegistration(scope('32345678901234567'))}>Інший сервер</button><button onClick={() => setRegistration(null)}>Сервер без доступу</button>
      {page === 'history' ? <MediaHistoryClient guildId={guildId} userId={userId} initial={selected.initial} initialError={null} history={{ items: [{ id: '00000000-0000-4000-8000-000000000004', track: historySong, playedAt: 1000, endedAt: 2000, result: 'finished', reason: null }], next: null }} /> : page === 'search' ? <MediaPlayerClient guildId={guildId} userId={userId} initial={selected.initial} initialError={null} /> : <p>Налаштування сервера</p>}
    </RuntimeLogsWorkspace>
  </DashboardMediaProvider></RuntimeLogsProvider>;
}
beforeEach(() => { vi.stubGlobal('React', React); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('preserves one ordered command stream while changing screens and hiding the nonblocking dock', async () => {
  const state = initial(); let acknowledge!: (response: Response) => void;
  const posts: Array<{ action: { type: string }; expectedQueueVersion: number }> = [];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/favorites')) return Response.json({ items: [], next: null });
    if (options?.method === 'POST') { const command = JSON.parse(String(options.body)); posts.push(command); if (posts.length === 1) return new Promise<Response>((resolve) => { acknowledge = resolve; }); return Response.json({ replayed: false, snapshot: state }); }
    return Response.json(state);
  }); vi.stubGlobal('fetch', fetch);
  render(<App />);
  const dock = screen.getByRole('complementary', { name: 'Панель плеєра' });
  await waitFor(() => expect(within(dock).getByRole('button', { name: 'Призупинити відтворення' }).hasAttribute('disabled')).toBe(false));
  expect(fetch.mock.calls.filter(([url]) => url === `/api/guilds/${guildId}/media`)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Додати до черги: History song' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Інший екран' }));
  fireEvent.click(screen.getByRole('button', { name: 'Плеєр' }));
  expect(screen.getByRole('button', { name: 'Відкрити плеєр' }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByText('Налаштування сервера')).toBeTruthy(); expect(dock.hasAttribute('inert')).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(document.body, { code: 'Space', key: ' ' }); expect(posts).toHaveLength(1);
  const updated = structuredClone(state); updated.session!.queue = [historySong]; updated.session!.queueVersion = 2;
  await act(async () => { acknowledge(Response.json({ replayed: false, snapshot: updated })); });
  fireEvent.click(screen.getByRole('button', { name: 'Відкрити плеєр' }));
  expect(screen.getByRole('button', { name: 'Приховати панель плеєра' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(within(dock).getByRole('button', { name: 'Призупинити відтворення' }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0]).toMatchObject({ action: { type: 'ADD_TRACK', provider: 'soundcloud', providerItemId: historySong.providerItemId }, expectedQueueVersion: 1 });
  expect(posts[1]).toMatchObject({ action: { type: 'PAUSE' }, expectedQueueVersion: 2 });
});
it('keeps logs and player open independently without navigating or blocking the main screen', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/favorites') ? { items: [], next: null } : url.includes('/runtime-logs') ? logState : initial())));
  const { container } = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Логи' }));
  await screen.findByText('Логи запуску');
  expect(screen.getByRole('complementary', { name: 'Панель плеєра' })).toBeTruthy();
  expect(container.querySelector('.runtime-logs-workspace')?.getAttribute('data-logs-open')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Інший екран' })); expect(screen.getByText('Налаштування сервера')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Плеєр' })); expect(screen.getByRole('complementary', { name: 'Логи поточного запуску' })).toBeTruthy();
});
it('replaces the selected guild and clears the dock when the server grants no media access', async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url.includes('/favorites') ? { items: [], next: null } : initial(url.includes('32345678901234567') ? '32345678901234567' : guildId)));
  vi.stubGlobal('fetch', fetch); render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Плеєр' }).title).toContain('First server'));
  fireEvent.click(screen.getByRole('button', { name: 'Інший сервер' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Плеєр' }).title).toContain('Second server'));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/api/guilds/32345678901234567/media')).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Сервер без доступу' }));
  expect(screen.queryByRole('complementary', { name: 'Панель плеєра' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Плеєр' })).toBeNull();
});

it('shares one composition across the header and dock and changes it only when a selected track enters playback', async () => {
  const state = initial();
  let acknowledge!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/favorites')) return Response.json({ items: [], next: null });
    if (options?.method === 'POST') return new Promise<Response>((resolve) => { acknowledge = resolve; });
    return Response.json(state);
  }));
  const { container } = render(<App />);
  const header = container.querySelector<HTMLElement>('.media-player-header-glow')!;
  const workspace = container.querySelector<HTMLElement>('.runtime-logs-workspace')!;
  const background = container.querySelector<HTMLElement>('.media-player-dock-background')!;
  const corner = container.querySelector<HTMLElement>('.runtime-logs-corner')!;
  const composition = () => background.style.getPropertyValue('--media-field-a-x');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Відтворити: History song' }).hasAttribute('disabled')).toBe(false));
  const first = composition();
  expect(header.style.cssText).toBe(background.style.cssText);
  expect(corner.style.cssText).toBe(background.style.cssText);
  expect(workspace.style.cssText).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Відтворити: History song' }));
  await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  expect(composition()).toBe(first);
  const updated = structuredClone(state);
  updated.session!.currentTrack = historySong;
  updated.session!.revision++;
  await act(async () => { acknowledge(Response.json({ replayed: false, snapshot: updated })); });
  expect(composition()).not.toBe(first);
  expect(header.style.cssText).toBe(background.style.cssText);
  const second = composition();
  fireEvent.click(screen.getByRole('button', { name: 'Плеєр' }));
  fireEvent.click(screen.getByRole('button', { name: 'Плеєр' }));
  fireEvent.click(screen.getByRole('button', { name: 'Інший екран' }));
  expect(composition()).toBe(second);
  expect(header.style.cssText).toBe(background.style.cssText);
});

it('keeps the gradient composition after volume changes and a seek that replaces the decoder ID', async () => {
  let state = initial();
  const actions: Array<{ type: string; volume?: number; queueItemId?: string; positionMs?: number }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/favorites')) return Response.json({ items: [], next: null });
    if (options?.method === 'POST') {
      const { action } = JSON.parse(String(options.body)); actions.push(action);
      state = structuredClone(state); state.session!.revision++;
      if (action.type === 'SET_VOLUME') state.session!.volume = action.volume;
      if (action.type === 'SEEK') state.session!.currentTrack!.queueItemId = '00000000-0000-4000-8000-000000000005';
      return Response.json({ replayed: false, snapshot: state });
    }
    return Response.json(state);
  }));
  const { container } = render(<App />);
  const background = container.querySelector<HTMLElement>('.media-player-dock-background')!;
  const volume = screen.getByRole('slider', { name: 'Гучність' });
  await waitFor(() => expect(volume.hasAttribute('disabled')).toBe(false));
  const first = background.style.cssText;
  fireEvent.change(volume, { target: { value: '65' } }); fireEvent.pointerUp(volume);
  await waitFor(() => expect(actions).toHaveLength(1));
  await waitFor(() => expect(container.querySelector('.media-player-dock .media-sync')?.textContent).toBe('Синхронізовано'));
  expect(background.style.cssText).toBe(first);
  const seek = screen.getByRole('slider', { name: 'Перемотати трек' });
  fireEvent.change(seek, { target: { value: '30000' } }); fireEvent.pointerUp(seek);
  await waitFor(() => expect(actions).toHaveLength(2));
  await waitFor(() => expect(container.querySelector('.media-player-dock .media-sync')?.textContent).toBe('Синхронізовано'));
  expect(actions[1]).toMatchObject({ type: 'SEEK', queueItemId: song.queueItemId, positionMs: 30000 });
  expect(state.session!.currentTrack!.queueItemId).not.toBe(song.queueItemId);
  expect(background.style.cssText).toBe(first);
});

it('places module status under the title and keeps synchronization only in the player and its topbar button', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/favorites') ? { items: [], next: null } : initial())));
  const { container } = render(<App startPage="search" />);
  await waitFor(() => expect(container.querySelector('.media-player-toggle i')?.getAttribute('data-status')).toBe('ready'));
  expect(container.querySelector('.dashboard-screen-title .module-status')?.textContent).toContain('Модуль увімкнено');
  expect(container.querySelector('.media-library .module-status')).toBeNull();
  expect(container.querySelector('.media-library .media-sync')).toBeNull();
  const header = container.querySelector<HTMLElement>('.media-player-dock-header')!;
  expect(within(header).getByRole('heading', { name: 'Плеєр' })).toBeTruthy();
  expect(within(header).getByRole('status').textContent).toBe('Синхронізовано');
  expect(within(header).queryByRole('button')).toBeNull();
  expect(header.textContent).not.toContain('First server');
  const badge = within(screen.getByRole('complementary', { name: 'Панель плеєра' })).getByRole('link', { name: 'SoundCloud' });
  expect(badge.getAttribute('href')).toBe(song.externalUrl);
  expect(badge.getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.keyDown(header, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Плеєр' }).getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Плеєр' }));
});

it.each([true, false])('honors playback permissions when returning to the latest played track (allowed=%s)', async (allowed) => {
  const selected = scope();
  const older = { ...historySong, providerItemId: 'https://soundcloud.com/artist/older', queueItemId: '00000000-0000-4000-8000-000000000006' };
  selected.initial.session!.played = [older, historySong];
  selected.initial.controls.PLAY_TRACK = allowed;
  const actions: object[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/favorites')) return Response.json({ items: [], next: null });
    if (options?.method === 'POST') { actions.push(JSON.parse(String(options.body)).action); return Response.json({ replayed: false, snapshot: selected.initial }); }
    return Response.json(selected.initial);
  }));
  render(<App selected={selected} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Плеєр' }).title).toContain('Синхронізовано'));
  const previous = screen.getByRole('button', { name: 'Попередній трек' });
  expect(previous.hasAttribute('disabled')).toBe(!allowed);
  fireEvent.click(previous);
  if (allowed) await waitFor(() => expect(actions).toEqual([{ type: 'PLAY_TRACK', provider: historySong.provider, providerItemId: historySong.providerItemId }]));
  else expect(actions).toHaveLength(0);
});

it('returns the current track to the beginning when the played list is empty', async () => {
  const actions: object[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/favorites')) return Response.json({ items: [], next: null });
    if (options?.method === 'POST') { actions.push(JSON.parse(String(options.body)).action); return Response.json({ replayed: false, snapshot: initial() }); }
    return Response.json(initial());
  }));
  render(<App />);
  const previous = screen.getByRole('button', { name: 'На початок треку' });
  await waitFor(() => expect(previous.hasAttribute('disabled')).toBe(false)); fireEvent.click(previous);
  await waitFor(() => expect(actions).toEqual([{ type: 'SEEK', queueItemId: song.queueItemId, positionMs: 0 }]));
});

it('does not rerender controller and favorites consumers when opening and closing the dock', async () => {
  const probe = vi.fn();
  const loaded = initial(); loaded.serverTimestamp = 12000;
  function LibraryProbe() {
    const controller = useWorkspaceMediaController(guildId, initial(), null);
    const favorites = useMediaFavorites(); probe();
    return <p>{controller.snapshot.serverTimestamp === loaded.serverTimestamp && !controller.unavailable && !favorites?.loading ? 'Library ready' : 'Library loading'}</p>;
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/favorites') ? { items: [], next: null } : loaded)));
  render(<DashboardMediaProvider initialScope={scope()}><MediaPlayerButton /><LibraryProbe /></DashboardMediaProvider>);
  await screen.findByText('Library ready');
  const renders = probe.mock.calls.length;
  const toggle = screen.getByRole('button', { name: 'Плеєр' });
  for (const expanded of ['false', 'true', 'false', 'true']) {
    fireEvent.click(toggle); expect(toggle.getAttribute('aria-expanded')).toBe(expanded);
    expect(probe).toHaveBeenCalledTimes(renders);
  }
});
