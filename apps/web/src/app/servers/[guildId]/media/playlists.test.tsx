// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaSettingsSchema, mediaSnapshotSchema } from '@scrt/validation';
import { PlaylistPreview } from './playlists';

const guildId = '12345678901234567', reference = 'https://soundcloud.com/artist/sets/list';
const snapshot = mediaSnapshotSchema.parse({ settings: mediaSettingsSchema.parse({ enabled: true, maxTracksPerUser: 100 }), session: null, controls: { PLAY_PLAYLIST: true, PLAY_TRACK: true, ADD_TRACK: true }, queueControls: {}, actorVoice: { id: guildId, name: 'Voice' }, remoteControl: false, listenerCount: 1, votes: { count: 0, required: 1 }, providers: [], engine: { available: true, ffmpeg: true, opus: true, dave: true }, canManage: false, serverTimestamp: 1 });
const track = (position: number) => ({ provider: 'soundcloud', providerItemId: `https://soundcloud.com/artist/song-${position}`, externalUrl: `https://soundcloud.com/artist/song-${position}`, title: `Song ${position}`, artist: 'Artist', durationMs: 60000, artworkUrl: null, type: 'track', playable: true, seekable: true, explicit: null });
const page = (second = false) => ({ playlist: { provider: 'soundcloud', providerItemId: reference, externalUrl: reference, title: 'List', artist: 'Artist', trackCount: 51, artworkUrl: null }, page: second ? 1 : 0, entries: (second ? [51] : [1, 2]).map((position) => ({ position, track: track(position) })), unavailableCount: 0, nextPage: second ? null : 1 });
beforeEach(() => {
  vi.stubGlobal('React', React);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('playlist preview', () => {
  it('opens without autoplay and sends distinct full-list, shuffled or single-track actions', async () => {
    const send = vi.fn(); const fetch = vi.fn<(url: string) => Promise<Response>>(async () => Response.json(page())); vi.stubGlobal('fetch', fetch);
    render(<PlaylistPreview guildId={guildId} reference={reference} onClose={vi.fn()} snapshot={snapshot} send={send} busy={false} unavailable={null} message="" />);
    await screen.findByText('Song 1'); expect(send).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]?.[0]).toContain('playlist=');
    fireEvent.click(screen.getByRole('button', { name: 'Відтворити по порядку' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'PLAY_PLAYLIST', providerItemId: reference, shuffle: false });
    fireEvent.click(screen.getByRole('button', { name: 'Перемішати й відтворити' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'PLAY_PLAYLIST', providerItemId: reference, shuffle: true });
    fireEvent.click(screen.getByRole('button', { name: 'Відтворити окремо: Song 2' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'PLAY_TRACK', provider: 'soundcloud', providerItemId: track(2).providerItemId }, track(2));
    fireEvent.click(screen.getByRole('button', { name: 'Додати до черги: Song 1' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'ADD_TRACK', provider: 'soundcloud', providerItemId: track(1).providerItemId }, track(1));
  });
  it('loads additional tracks in order and disables playback without Voice while keeping browsing available', async () => {
    const fetch = vi.fn(async (url: string) => Response.json(page(url.includes('page=1')))); vi.stubGlobal('fetch', fetch);
    const noVoice = { ...snapshot, actorVoice: { id: null, name: null }, controls: {} };
    render(<PlaylistPreview guildId={guildId} reference={reference} onClose={vi.fn()} snapshot={noVoice} send={vi.fn()} busy={false} unavailable={null} message="" />);
    await screen.findByText('Song 1');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Відтворити по порядку' }).disabled).toBe(true);
    expect(screen.getByText('Для відтворення приєднайтеся до голосового каналу.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще треки' }));
    await screen.findByText('Song 51'); expect(screen.getByText('Song 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Показати ще треки' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Знайти пісню в плейлисті' }), { target: { value: '51' } });
    expect(screen.queryByText('Song 1')).toBeNull(); expect(screen.getByText('Song 51')).toBeTruthy();
  });
  it('shows source errors with retry and cancels reading on close', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: 'SoundCloud unavailable' }, { status: 422 })).mockResolvedValueOnce(Response.json(page())); vi.stubGlobal('fetch', fetch);
    const props = { guildId, reference, onClose: vi.fn(), snapshot, send: vi.fn(), busy: false, unavailable: null, message: '' };
    const view = render(<PlaylistPreview {...props} />);
    await screen.findByText('SoundCloud unavailable'); fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' })); await screen.findByText('Song 1');
    expect(props.send).not.toHaveBeenCalled();
    let resolve!: (response: Response) => void; fetch.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще треки' }));
    const signal = fetch.mock.calls.at(-1)![1].signal as AbortSignal;
    view.rerender(<PlaylistPreview {...props} reference={null} />); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(Response.json(page(true))); }); await waitFor(() => expect(screen.queryByText('Song 51')).toBeNull());
  });
});
