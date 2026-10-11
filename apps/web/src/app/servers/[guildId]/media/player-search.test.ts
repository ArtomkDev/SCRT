// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerSearch } from './player-search';

const track = (id: string) => ({ provider: 'youtube', providerItemId: id, title: id, artist: 'Artist', type: 'track', durationMs: 10000, artworkUrl: null, externalUrl: `https://youtube.com/watch?v=${id}`, playable: true, seekable: false, explicit: null });
const message = vi.fn();
const hook = (guild = 'guild', user = 'user') => renderHook(() => usePlayerSearch(guild, user, [], message));
beforeEach(() => { sessionStorage.clear(); message.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('persistent paginated Media search', () => {
  it('reuses successful searches instantly and expires the cache', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [track('A')], unavailable: [], nextPage: 1, matchedQuery: 'Artist' })); vi.stubGlobal('fetch', fetch);
    const { result } = hook();
    act(() => result.current.setQuery('Artst')); await act(() => result.current.search());
    expect(result.current.matchedQuery).toBe('Artist');
    await act(() => result.current.search()); expect(fetch).toHaveBeenCalledOnce();
    clock.mockReturnValue(1120001); await act(() => result.current.search()); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('cancels a previous query immediately and ignores its late result', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })).mockResolvedValueOnce(Response.json({ results: [track('B')], unavailable: [] })); vi.stubGlobal('fetch', fetch);
    const { result } = hook(); act(() => result.current.setQuery('First'));
    let pending!: Promise<void>; act(() => { pending = result.current.search(); });
    expect(result.current.searchingQuery).toBe('First');
    act(() => result.current.setQuery('Second')); await act(() => result.current.search());
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true); expect(result.current.results[0]?.title).toBe('B');
    await act(async () => { resolve(Response.json({ results: [track('A')], unavailable: [] })); await pending; });
    expect(result.current.results[0]?.title).toBe('B'); expect(result.current.searchPending).toBe(false);
  });
  it('does not cache unavailable sources and clears the cache across guilds', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ results: [track('A')], unavailable: ['YouTube'] })).mockResolvedValue(Response.json({ results: [track('B')], unavailable: [] })); vi.stubGlobal('fetch', fetch);
    const { result, rerender } = renderHook(({ guild }) => usePlayerSearch(guild, 'user', [], message), { initialProps: { guild: 'first' } });
    act(() => result.current.setQuery('Artist')); await act(() => result.current.search()); await act(() => result.current.search()); expect(fetch).toHaveBeenCalledTimes(2);
    rerender({ guild: 'second' }); act(() => result.current.setQuery('Artist')); await act(() => result.current.search()); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('removes cached YouTube results and their active filter when production search is enabled', async () => {
    const soundcloud = { ...track('SC'), provider: 'soundcloud', providerItemId: 'https://soundcloud.com/artist/song', externalUrl: 'https://soundcloud.com/artist/song' };
    sessionStorage.setItem('scrt:media-search:v1:user:guild', JSON.stringify({ version: 1, savedAt: Date.now(), query: 'Artist', submittedQuery: 'Artist', results: [track('YT'), soundcloud], searched: true, source: 'youtube', mobileTab: 'search', nextPage: null }));
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [track('YT'), soundcloud], unavailable: [] })); vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => usePlayerSearch('guild', 'user', [], message, false));
    expect(result.current.source).toBe('all'); expect(result.current.results).toEqual([soundcloud]);
    await act(() => result.current.search()); expect(result.current.results).toEqual([soundcloud]);
  });
  it('aborts an old search and clears its pending state when YouTube becomes disabled', async () => {
    let resolve!: (value: Response) => void;
    const soundcloud = { ...track('SC'), provider: 'soundcloud', providerItemId: 'https://soundcloud.com/artist/song', externalUrl: 'https://soundcloud.com/artist/song' };
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })).mockResolvedValueOnce(Response.json({ results: [soundcloud], unavailable: [] })); vi.stubGlobal('fetch', fetch);
    const { result, rerender } = renderHook(({ allowed }) => usePlayerSearch('guild', 'user', [], message, allowed), { initialProps: { allowed: true } });
    act(() => result.current.setQuery('Artist')); let pending!: Promise<void>;
    act(() => { pending = result.current.search(); }); expect(result.current.searchPending).toBe(true);
    rerender({ allowed: false });
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true); expect(result.current.searchPending).toBe(false);
    await act(() => result.current.search()); expect(result.current.results).toEqual([soundcloud]);
    await act(async () => { resolve(Response.json({ results: [track('late')], unavailable: [] })); await pending; });
    expect(result.current.results).toEqual([soundcloud]);
  });
  it('starts artist discovery immediately without using the previous query draft', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [track('A')], unavailable: [], nextPage: 1 }));
    vi.stubGlobal('fetch', fetch); const { result } = hook();
    act(() => result.current.setQuery('old draft'));
    await act(async () => { result.current.setQuery('New Artist'); await result.current.search(false, 'New Artist'); });
    expect(new URL(fetch.mock.calls[0]![0], 'http://localhost').searchParams.get('q')).toBe('New Artist');
    expect(result.current.query).toBe('New Artist'); expect(result.current.submittedQuery).toBe('New Artist');
    await act(() => result.current.search(true));
    expect(new URL(fetch.mock.calls[1]![0], 'http://localhost').searchParams.get('q')).toBe('New Artist');
  });
  it('preserves a newly edited draft when artist discovery finishes later', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const { result } = hook(); let pending!: Promise<void>;
    act(() => { pending = result.current.search(false, 'New Artist'); });
    expect(result.current.query).toBe('New Artist');
    act(() => result.current.setQuery('next draft'));
    await act(async () => { resolve(Response.json({ results: [track('A')], unavailable: [] })); await pending; });
    expect(result.current.query).toBe('next draft'); expect(result.current.submittedQuery).toBe('New Artist');
  });
  it('appends the next page without duplicates and uses the submitted search rather than an edited draft', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ results: [track('A')], unavailable: [], nextPage: 1 })).mockResolvedValueOnce(Response.json({ results: [track('A'), track('B')], unavailable: [], nextPage: null }));
    vi.stubGlobal('fetch', fetch); const { result } = hook();
    act(() => result.current.setQuery('Artist'));
    await act(() => result.current.search());
    act(() => result.current.setQuery('different draft'));
    await act(() => result.current.search(true));
    expect(new URL(fetch.mock.calls[1]![0], 'http://localhost').searchParams.get('q')).toBe('Artist');
    expect(new URL(fetch.mock.calls[1]![0], 'http://localhost').searchParams.get('page')).toBe('1');
    expect(result.current.results.map((item) => item.title)).toEqual(['A', 'B']); expect(result.current.nextPage).toBeNull();
    await act(() => result.current.search(true)); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('restores the query, accumulated results, page, source and mobile screen after navigation', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [track('A')], unavailable: [], nextPage: 1 }));
    vi.stubGlobal('fetch', fetch); const first = hook();
    act(() => first.result.current.setQuery('Artist')); await act(() => first.result.current.search());
    act(() => { first.result.current.setSource('youtube'); first.result.current.setMobileTab('queue'); });
    first.unmount(); const second = hook();
    expect(second.result.current).toMatchObject({ query: 'Artist', submittedQuery: 'Artist', results: [track('A')], source: 'youtube', mobileTab: 'queue', searched: true, nextPage: 1 });
    expect(fetch).toHaveBeenCalledOnce();
    const differentUser = hook('guild', 'another'); const differentGuild = hook('another', 'user');
    expect(differentUser.result.current.results).toEqual([]); expect(differentGuild.result.current.query).toBe('');
  });
  it('retains loaded results and allows retry after a later page fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ results: [track('A')], unavailable: [], nextPage: 1 })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ results: [track('B')], unavailable: [], nextPage: null }));
    vi.stubGlobal('fetch', fetch); const { result } = hook();
    act(() => result.current.setQuery('Artist')); await act(() => result.current.search());
    await act(() => result.current.search(true)); expect(result.current.results.map((item) => item.title)).toEqual(['A']); expect(result.current.nextPage).toBe(1);
    await act(() => result.current.search(true)); expect(result.current.results.map((item) => item.title)).toEqual(['A', 'B']);
  });
  it('aborts a departing page and never overwrites the restored results with a late response', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ results: [track('A')], unavailable: [], nextPage: 1 })).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch); const first = hook();
    act(() => first.result.current.setQuery('Artist')); await act(() => first.result.current.search());
    let pending!: Promise<void>; act(() => { pending = first.result.current.search(true); }); first.unmount();
    expect(fetch.mock.calls[1]![1].signal.aborted).toBe(true);
    await act(async () => { resolve(Response.json({ results: [track('late')], unavailable: [], nextPage: null })); await pending; });
    const second = hook(); expect(second.result.current.results.map((item) => item.title)).toEqual(['A']);
  });
  it('ignores invalid storage and keeps searching when browser storage is unavailable', async () => {
    sessionStorage.setItem('scrt:media-search:v1:user:guild', '{invalid');
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [track('A')], unavailable: [] })); vi.stubGlobal('fetch', fetch);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    const { result } = hook(); expect(result.current.query).toBe('');
    act(() => result.current.setQuery('Artist')); await act(() => result.current.search()); expect(result.current.results).toHaveLength(1);
  });
});
