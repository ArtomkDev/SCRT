// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { generatedArtwork } from '@scrt/artwork';
import type { ArtworkSearchUpdate, SignedArtworkGallery } from '@scrt/shared';
const mocks = vi.hoisted(() => ({ search: vi.fn(), select: vi.fn(), refresh: vi.fn() }));
vi.stubGlobal('React', React);
vi.mock('@/lib/artwork-search-client', () => ({ streamArtworkSearch: mocks.search }));
vi.mock('./artwork-actions', () => ({ selectActivityArtwork: mocks.select }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { ArtworkPicker } from './artwork-picker';
const guildId = '12345678901234567';
const identity = { gameKey: 'name:valheim', displayName: 'Valheim', applicationId: null };
let revision = 0;
function gallery(source: SignedArtworkGallery['source'], field = 'icon', title = 'Valheim · icon · 512×512'): SignedArtworkGallery {
  return { source, status: source === 'steamgriddb' ? 'ok' : 'not_found', games: [], nextPage: null,
    assets: source === 'steamgriddb' ? [{ asset: { url: `https://cdn2.steamgriddb.com/${revision}-${field}.png`, source, kind: field === 'hero' ? 'hero' : 'icon', entityId: '42', attributionUrl: null }, previewUrl: `https://cdn2.steamgriddb.com/${revision}-thumb.png`, title, token: 'signed-' + field }] : [] };
}
async function open(strict = false, manual = false) {
  const artwork = generatedArtwork(identity); artwork.revision = revision;
  if (manual) artwork.overrides.iconUrl = 'https://images.example.com/current-manual.png';
  const component = <ArtworkPicker guildId={guildId} identity={identity} artwork={artwork} />;
  const view = render(strict ? <React.StrictMode>{component}</React.StrictMode> : component);
  const trigger = screen.getByRole('button', { name: 'Оформлення' }); trigger.focus(); fireEvent.click(trigger);
  await screen.findByRole('dialog');
  return { ...view, trigger };
}
function search(value?: string) {
  const input = screen.getByLabelText('Пошук оформлення');
  if (value) fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
}
beforeEach(() => {
  vi.resetAllMocks(); revision++;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.removeAttribute('open'); setTimeout(() => this.dispatchEvent(new Event('close')), 0); };
  URL.createObjectURL = vi.fn(() => 'blob:upload-preview'); URL.revokeObjectURL = vi.fn();
  mocks.search.mockImplementation(async (_guild, input, _signal, update) => {
    for (const field of input.field === 'both' ? ['icon', 'hero'] : [input.field]) update({ field, result: gallery(input.source, field) });
  });
  mocks.select.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('artwork selection workflow', () => {
  it('loads one initial batch in Strict Mode with current manual artwork, a portal, and focus restoration', async () => {
    const { container, trigger } = await open(true, true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect((screen.getByRole('dialog') as HTMLDialogElement).open).toBe(true);
    expect(container.querySelector('dialog')).toBeNull();
    expect(screen.getByText(/Вибрано вручну/)).toBeTruthy();
    expect(document.querySelector('[aria-label="Поточна іконка"] img')?.getAttribute('src')).toContain('current-manual');
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(5));
    expect(mocks.search.mock.calls.every(call => call[1].field === 'both')).toBe(true);
    expect((screen.getByRole('button', { name: 'Застосувати' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => (screen.getByRole('dialog') as HTMLDialogElement).close());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
  it('automatically loads candidates, selects without saving, and cancels without touching the override', async () => {
    await open(false, true);
    const candidate = await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    expect(mocks.search).toHaveBeenCalledTimes(5);
    fireEvent.click(candidate); expect(candidate.getAttribute('aria-pressed')).toBe('true');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Поточна іконка"] img')?.getAttribute('src')).toContain('current-manual');
    expect(document.querySelector('[aria-label="Попередній перегляд"] img')?.getAttribute('src')).toContain(`${revision}-icon`);
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.select).not.toHaveBeenCalled();
  });
  it('applies only the selected signed banner and refreshes after success', async () => {
    await open(); await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Іконка' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Банер' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Банер' }));
    fireEvent.click(screen.getByRole('button', { name: /SteamGridDB, варіант 1/ }));
    expect(mocks.select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const form = mocks.select.mock.calls[0]![1] as FormData;
    expect(form.get('mode')).toBe('candidate'); expect(form.get('field')).toBe('hero'); expect(form.get('token')).toBe('signed-hero');
    expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.search).toHaveBeenCalledTimes(5);
  });
  it('reuses fresh results after close/reopen and switches fields/filter without new searches', async () => {
    const { trigger } = await open(); await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    fireEvent.change(screen.getByLabelText('Джерело'), { target: { value: 'discord' } });
    expect(screen.queryByRole('button', { name: /SteamGridDB, варіант/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Джерело'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' })); fireEvent.click(trigger);
    await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    fireEvent.click(screen.getByRole('tab', { name: 'Банер' }));
    expect(screen.getByRole('button', { name: /SteamGridDB, варіант 1/ })).toBeTruthy();
    expect(mocks.search).toHaveBeenCalledTimes(5);
  });
  it('automatically reloads expired galleries when reopened', async () => {
    const { trigger } = await open(); await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    expect(mocks.search).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000 + 1);
    fireEvent.click(trigger);
    await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    expect(mocks.search).toHaveBeenCalledTimes(10);
  });
  it('ignores stale streamed results, deduplicates a repeated in-flight submission, and aborts on close', async () => {
    const callbacks: Array<(update: ArtworkSearchUpdate) => void> = [];
    mocks.search.mockImplementation((_guild, _input, _signal, update) => { callbacks.push(update); return new Promise(() => {}); });
    await open(); await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(5));
    search(); search(); expect(mocks.search).toHaveBeenCalledTimes(5);
    search('Valheim corrected'); expect(mocks.search).toHaveBeenCalledTimes(10);
    expect(mocks.search.mock.calls.slice(0, 5).every(call => call[2].aborted)).toBe(true);
    act(() => callbacks[1]!({ field: 'icon', result: gallery('steamgriddb') }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    expect(screen.queryByRole('button', { name: /SteamGridDB, варіант/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Закрити оформлення' }));
    expect(mocks.search.mock.calls.every(call => call[2].aborted)).toBe(true);
  });
  it('hides raw titles and unknown dimensions; a broken thumbnail falls back and cannot be selected', async () => {
    mocks.search.mockImplementation(async (_guild, input, _signal, update) => update({ field: 'icon', result: gallery(input.source, 'icon', 'Valheim · icon · 0×0') }));
    await open(); search(); const candidate = await screen.findByRole('button', { name: 'SteamGridDB, варіант 1' });
    expect(screen.queryByText(/0×0/)).toBeNull(); expect(screen.queryByText(/Valheim · icon/)).toBeNull();
    fireEvent.error(candidate.querySelector('img')!);
    expect(candidate.querySelector('img')).toBeNull(); expect((candidate as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps successful results usable when a provider fails without exposing its exception', async () => {
    mocks.search.mockImplementation(async (_guild, input, _signal, update) => { if (input.source === 'igdb') throw new Error('secret upstream response'); update({field:'icon',result:gallery(input.source)}); });
    await open(); search(); await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    expect(await screen.findByText(/IGDB тимчасово недоступний/)).toBeTruthy(); expect(screen.queryByText(/secret upstream/)).toBeNull();
  });
  it('previews a manual URL without saving and preserves the draft after save failure', async () => {
    mocks.select.mockRejectedValue(new Error('internal provider failure'));
    await open(); fireEvent.click(screen.getByRole('tab', { name: 'Банер' }));
    fireEvent.click(screen.getByRole('button', { name: 'Власне зображення' }));
    fireEvent.change(screen.getByLabelText('URL зображення'), { target: { value: 'https://images.example.com/new-banner.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Переглянути' })); expect(mocks.select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Не вдалося зберегти оформлення. Спробуйте ще раз.');
    const form = mocks.select.mock.calls[0]![1] as FormData;
    expect(form.get('field')).toBe('hero'); expect(form.get('url')).toBe('https://images.example.com/new-banner.png');
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('previews uploads, saves only on Apply, and releases the local preview URL', async () => {
    await open(); fireEvent.click(screen.getByRole('button', { name: 'Власне зображення' }));
    const file = new File(['png'], 'icon.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Завантажити зображення'), { target: { files: [file] } });
    expect(mocks.select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((mocks.select.mock.calls[0]![1] as FormData).get('file')).toBe(file); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:upload-preview');
  });
  it('stages automatic selection and does not persist it on Cancel', async () => {
    await open(false, true); fireEvent.click(screen.getByRole('button', { name: 'Автоматичний вибір' }));
    expect(mocks.select).not.toHaveBeenCalled(); expect(screen.getByText(/Ручний вибір для цього поля буде скинуто/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' })); expect(mocks.select).not.toHaveBeenCalled();
  });
  it('preserves pagination and corrected provider matches without changing tracked identity', async () => {
    mocks.search.mockImplementation(async (_guild, input, _signal, update) => {
      for (const field of input.field === 'both' ? ['icon','hero'] : [input.field]) update({ field, result: { ...gallery(input.source,field), games: input.source === 'steamgriddb' ? [{ id:'42',name:'Valheim' }] : [], nextPage: input.source === 'steamgriddb' && !input.page ? 1 : null } });
    });
    await open(); search('Valheim corrected'); await screen.findByRole('button', { name: /SteamGridDB, варіант 1/ });
    fireEvent.click(screen.getByRole('tab', { name: 'Банер' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Показати ще' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }));
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith(guildId,expect.objectContaining({field:'hero',page:1}),expect.anything(),expect.any(Function)));
    await waitFor(() => expect(screen.queryByText('Пошук оформлення…')).toBeNull());
    fireEvent.click(screen.getByText('Інший збіг за назвою'));
    fireEvent.change(screen.getByLabelText('SteamGridDB'), { target: { value: '42' } });
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith(guildId,expect.objectContaining({gameKey:identity.gameKey,field:'both',entityId:'42',query:'Valheim corrected'}),expect.anything(),expect.any(Function)));
  });
});
