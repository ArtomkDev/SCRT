// @vitest-environment jsdom
import * as React from 'react';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mediaSettingsSchema, mediaSnapshotSchema, type MediaHistoryPage } from '@scrt/validation';
import type { MediaHistoryItem } from '@scrt/shared';
import { MediaHistoryClient } from './history';

const guildId = '12345678901234567', userId = '22345678901234567', otherId = '32345678901234567';
function item(title: string, actor = userId): MediaHistoryItem {
  const endedAt = Date.now() - 1000;
  return { id: randomUUID(), playedAt: endedAt - 3000, endedAt, result: 'finished', reason: null, track: { provider: 'youtube', providerItemId: title, title, artist: 'Artist', durationMs: 60000, type: 'track', artworkUrl: null, externalUrl: 'https://youtube.com/watch?v=abcdefghijk', playable: true, seekable: false, explicit: null, queueItemId: randomUUID(), requestedByUserId: actor, requestedByName: actor === userId ? 'Me' : 'Other', requestedAt: endedAt - 4000 } };
}
const initial = () => mediaSnapshotSchema.parse({ session: null, settings: mediaSettingsSchema.parse({ enabled: true }), actorVoice: { id: otherId, name: 'Gaming' }, controls: { PLAY_TRACK: true }, queueControls: {}, remoteControl: false, listenerCount: 1, votes: { count: 0, required: 1 }, providers: [], engine: { available: true, ffmpeg: true, opus: true, dave: true }, serverTimestamp: Date.now(), canManage: true });
function mount(history: MediaHistoryPage, fetch: (url: string, init?: RequestInit) => Promise<Response>, unavailable: string | null = null) {
  vi.stubGlobal('fetch', vi.fn(fetch));
  return render(<MediaHistoryClient guildId={guildId} userId={userId} history={history} initial={initial()} initialError={unavailable} />);
}
beforeEach(() => {
  vi.stubGlobal('React', React);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Media history interactions', () => {
  it('plays immediately through the existing authorized command stream with canonical references only', async () => {
    const own = item('Own song'); const mutations: unknown[] = []; const snapshot = initial();
    mount({ items: [own], next: null }, async (_url, request) => {
      if (request?.method === 'POST') { mutations.push(JSON.parse(String(request.body))); return Response.json({ replayed: false, snapshot }); }
      return Response.json(snapshot);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Відтворити: Own song' }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]).toEqual({ commandId: expect.any(String), sessionId: null, expectedQueueVersion: null, action: { type: 'PLAY_TRACK', provider: 'youtube', providerItemId: 'Own song' } });
  });
  it('shows deletion only for own entries and requires confirmation; cancelling leaves all history intact', async () => {
    const own = item('Own song'); const other = item('Other song', otherId); const mutations: unknown[] = [];
    mount({ items: [own, other], next: null }, async (_url, request) => {
      if (request?.method === 'DELETE') { mutations.push(JSON.parse(String(request.body))); return Response.json({ deleted: 1, more: false }); }
      return Response.json(initial());
    });
    expect(screen.queryByRole('button', { name: 'Видалити запис: Other song' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Видалити запис: Own song' }));
    expect(mutations).toEqual([]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Скасувати' }));
    expect(screen.getByText('Own song')).toBeTruthy(); expect(mutations).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Видалити запис: Own song' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити запис' }));
    await waitFor(() => expect(screen.queryByText('Own song')).toBeNull());
    expect(screen.getByText('Other song')).toBeTruthy();
    expect(mutations).toEqual([{ type: 'DELETE_ITEM', id: own.id }]);
  });
  it('clears own entries across all backend batches while keeping the other participant history', async () => {
    const own = item('Own song'); const other = item('Other song', otherId); const mutations: unknown[] = [];
    mount({ items: [own, other], next: null }, async (_url, request) => {
      if (request?.method === 'DELETE') { mutations.push(JSON.parse(String(request.body))); return Response.json({ deleted: mutations.length === 1 ? 100 : 2, more: mutations.length === 1 }); }
      return Response.json(initial());
    });
    fireEvent.click(screen.getByRole('button', { name: 'Очистити мою історію' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Очистити мою історію' }));
    await waitFor(() => expect(screen.queryByText('Own song')).toBeNull());
    expect(mutations).toEqual([{ type: 'CLEAR_OWN' }, { type: 'CLEAR_OWN' }]); expect(screen.getByText('Other song')).toBeTruthy();
  });
  it('keeps denied entries visible and explains the failure inside the confirmation dialog', async () => {
    const own = item('Own song');
    mount({ items: [own], next: null }, async (_url, request) => request?.method === 'DELETE' ? Response.json({ error: 'Недостатньо прав.' }, { status: 403 }) : Response.json(initial()));
    fireEvent.click(screen.getByRole('button', { name: 'Видалити запис: Own song' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити запис' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Недостатньо прав.'));
    expect(screen.getAllByText('Own song')).toHaveLength(2);
  });
  it('appends older entries once using the timestamp/ID cursor instead of replacing the current page', async () => {
    const recent = item('Recent song'); const older = item('Older song'); const urls: string[] = [];
    mount({ items: [recent], next: { endedAt: recent.endedAt, id: recent.id } }, async (url) => {
      if (url.includes('?history=')) { urls.push(url); return Response.json({ items: [recent, older], next: null }); }
      return Response.json(initial());
    });
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити ще' }));
    await waitFor(() => expect(screen.getByText('Older song')).toBeTruthy());
    expect(screen.getAllByText('Recent song')).toHaveLength(1); expect(urls[0]).toContain(`before=${recent.endedAt}&beforeId=${recent.id}`);
    expect(screen.queryByRole('button', { name: 'Завантажити ще' })).toBeNull();
  });
  it('does not play when the worker is unavailable while allowing own-history cleanup', async () => {
    const own = item('Own song');
    mount({ items: [own], next: null }, async () => Response.json({ error: 'Worker недоступний' }, { status: 503 }), 'Worker недоступний');
    expect((screen.getByRole('button', { name: 'Відтворити: Own song' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Видалити запис: Own song' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
