// @vitest-environment jsdom
import * as React from 'react';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaSettingsSchema, mediaSnapshotSchema, type MediaFavorite } from '@scrt/validation';
const mocks = vi.hoisted(() => ({ send: vi.fn(), message: vi.fn() }));
vi.mock('../player-controller', async (original) => ({ ...await original<typeof import('../player-controller')>(), useMediaController: (_guild: string, initial: unknown) => ({ snapshot: initial, pending: [], send: mocks.send, message: '', unavailable: null, setMessage: mocks.message }) }));
import { FavoriteButton, MediaFavoritesProvider } from '../favorites-context';
import { MediaFavoritesClient } from './favorites';
const guildId = '12345678901234567', userId = '22345678901234567', otherId = '32345678901234567';
const initial = mediaSnapshotSchema.parse({ settings: mediaSettingsSchema.parse({ enabled: true }), session: null, controls: { PLAY_FAVORITES: true, PLAY_TRACK: true, ADD_TRACK: true }, queueControls: {}, actorVoice: { id: guildId, name: 'Voice' }, remoteControl: false, listenerCount: 1, votes: { count: 0, required: 1 }, providers: [], engine: { available: true, ffmpeg: true, opus: true, dave: true }, canManage: false, serverTimestamp: 1 });
function favorite(number: number, likers = [userId, otherId]): MediaFavorite {
  const title = `Song ${number}`; const url = `https://soundcloud.com/artist/song-${number}`;
  return { id: number.toString(16).padStart(64, '0'), track: { provider: 'soundcloud', providerItemId: url, title, artist: 'Artist', type: 'track', durationMs: 60000, artworkUrl: null, externalUrl: url, playable: true, seekable: true, explicit: null }, likedBy: likers.map((id) => ({ userId: id, name: id === userId ? 'Me' : 'Other', likedAt: 1 })), updatedAt: number };
}
const view = (allowYoutube = false) => render(<MediaFavoritesProvider guildId={guildId} userId={userId} allowYoutube={allowYoutube}><MediaFavoritesClient guildId={guildId} initial={initial} initialError={null} /></MediaFavoritesProvider>);
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('React', React); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('favorites collection and hearts', () => {
  it('does not expose previous guild hearts or accept their late responses when the shared scope changes', async () => {
    const song = favorite(1); let first!: (response: Response) => void;
    const fetch = vi.fn((url: string) => url.includes('/32345678901234567/') ? Promise.resolve(Response.json({ items: [], next: null })) : new Promise<Response>((resolve) => { first = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const view = (id: string) => <MediaFavoritesProvider guildId={id} userId={userId} allowYoutube={false}><FavoriteButton track={song.track} /></MediaFavoritesProvider>;
    const rendered = render(view(guildId)); rendered.rerender(view('32345678901234567'));
    const heart = screen.getByRole('button', { name: 'Вподобати: Song 1' });
    await waitFor(() => expect(heart.hasAttribute('disabled')).toBe(false));
    await act(async () => { first(Response.json({ items: [song], next: null })); });
    expect(heart.getAttribute('aria-pressed')).toBe('false');
  });
  it('keeps favorite playlists in their own tab, filters by liker and saves only an own heart', async () => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    const saved = [1, 2].map((number) => ({ id: number.toString(16).padStart(64, '0'), playlist: { provider: 'soundcloud', providerItemId: `https://soundcloud.com/artist/sets/list-${number}`, externalUrl: `https://soundcloud.com/artist/sets/list-${number}`, title: `Playlist ${number}`, artist: 'Artist', trackCount: 3, artworkUrl: null }, likedBy: [{ userId: number === 1 ? userId : otherId, name: number === 1 ? 'Me' : 'Other', likedAt: 1 }], updatedAt: number }));
    const fetch = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ item: null }) : Response.json({ items: url.includes('/playlists') ? saved : [], next: null })); vi.stubGlobal('fetch', fetch);
    view(); fireEvent.click(screen.getByRole('button', { name: 'Плейлисти' }));
    await screen.findByText('Playlist 2'); expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Фільтр за користувачем', { selector: 'select' }), { target: { value: 'me' } });
    expect(screen.queryByText('Playlist 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Зняти сердечко: Playlist 1' }));
    await waitFor(() => expect(screen.queryByText('Playlist 1')).toBeNull());
    const mutation = fetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(mutation?.[0]).toContain('/favorites/playlists'); expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({ providerItemId: saved[0]!.playlist.providerItemId, liked: false });
    fireEvent.click(screen.getByRole('button', { name: 'Пісні' })); fireEvent.click(screen.getByRole('button', { name: 'Плейлисти' }));
    expect(fetch.mock.calls.filter((call) => call[0].includes('/favorites/playlists') && !call[1]?.method)).toHaveLength(1);
  });
  it('loads all pages, filters by liker and plays all distinct filtered favorites', async () => {
    const items = [favorite(1), favorite(2, [otherId]), favorite(3, [userId])];
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ items: items.slice(0, 2), next: items[1]!.id })).mockResolvedValueOnce(Response.json({ items: items.slice(2), next: null })); vi.stubGlobal('fetch', fetch);
    view(); await screen.findByText('Song 3');
    expect(fetch.mock.calls[1]?.[0]).toContain(`?after=${items[1]!.id}`);
    expect(within(screen.getByRole('list', { name: 'Лайкнуті пісні' })).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Відтворити всі · 3' }));
    expect(mocks.send).toHaveBeenLastCalledWith({ type: 'PLAY_FAVORITES', favoriteIds: [items[2]!.id, items[1]!.id, items[0]!.id] }, items[2]!.track);
    fireEvent.change(screen.getByLabelText('Фільтр за користувачем', { selector: 'select' }), { target: { value: 'me' } });
    expect(screen.queryByText('Song 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Відтворити всі · 2' }));
    expect(mocks.send).toHaveBeenLastCalledWith({ type: 'PLAY_FAVORITES', favoriteIds: [items[2]!.id, items[0]!.id] }, items[2]!.track);
    fireEvent.change(screen.getByLabelText('Фільтр за користувачем', { selector: 'select' }), { target: { value: otherId } });
    expect(screen.queryByText('Song 3')).toBeNull(); expect(screen.getByText('Song 2')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Пошук в улюблених' }), { target: { value: 'Song 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Відтворити всі · 1' }));
    expect(mocks.send).toHaveBeenLastCalledWith({ type: 'PLAY_FAVORITES', favoriteIds: [items[1]!.id] }, items[1]!.track);
  });
  it('changes only an own heart after server confirmation and retains the song liked by someone else', async () => {
    const item = favorite(1); let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ items: [item], next: null })).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    view(); const button = await screen.findByRole('button', { name: 'Зняти сердечко: Song 1' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true'); expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ provider: item.track.provider, providerItemId: item.track.providerItemId, liked: false });
    await act(async () => { resolve(Response.json({ item: { ...item, likedBy: item.likedBy.filter((like) => like.userId !== userId) } })); });
    expect(screen.getByText('Song 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Вподобати: Song 1' }).getAttribute('aria-pressed')).toBe('false');
  });
  it('does not lose hearts on navigation and recovers the initial fetch in React Strict Mode', async () => {
    const item = favorite(1); const fetch = vi.fn(async () => Response.json({ items: [item], next: null })); vi.stubGlobal('fetch', fetch);
    const root = (tab: boolean) => <StrictMode><MediaFavoritesProvider guildId={guildId} userId={userId} allowYoutube={false}>{tab ? <MediaFavoritesClient guildId={guildId} initial={initial} initialError={null} /> : <FavoriteButton track={item.track} />}</MediaFavoritesProvider></StrictMode>;
    const rendered = render(root(true)); await screen.findByText('Song 1');
    const count = fetch.mock.calls.length;
    rendered.rerender(root(false));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Зняти сердечко: Song 1' }) as HTMLButtonElement).disabled).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it('hides YouTube favorites in production and keeps an own heart on a failed save', async () => {
    const item = favorite(1); const youtube: MediaFavorite = { ...favorite(2), track: { ...favorite(2).track, provider: 'youtube', providerItemId: 'abcdefghijk', externalUrl: 'https://youtube.com/watch?v=abcdefghijk' } };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ items: [item, youtube], next: null })).mockResolvedValueOnce(Response.json({ error: 'Немає доступу' }, { status: 403 })); vi.stubGlobal('fetch', fetch);
    view(); const button = await screen.findByRole('button', { name: 'Зняти сердечко: Song 1' });
    expect(screen.queryByText('Song 2')).toBeNull(); fireEvent.click(button);
    await screen.findByRole('alert'); expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});
