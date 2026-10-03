import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamArtworkSearch } from './artwork-search-client';
afterEach(() => vi.unstubAllGlobals());
describe('progressive artwork search transport', () => {
  it('delivers a split UTF-8 result before the response finishes', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(stream)); vi.stubGlobal('fetch', fetcher);
    const update = vi.fn(); const signal = new AbortController().signal;
    const promise = streamArtworkSearch('12345678901234567', { gameKey: 'name:valheim', source: 'igdb', query: 'Гра' }, signal, update);
    const bytes = new TextEncoder().encode(JSON.stringify({ field: 'hero', error: 'Пошук' }) + '\n');
    const split = bytes.findIndex((value) => value >= 192) + 1;
    controller.enqueue(bytes.slice(0, split)); await Promise.resolve(); expect(update).not.toHaveBeenCalled();
    controller.enqueue(bytes.slice(split));
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ field: 'hero', error: 'Пошук' }));
    controller.enqueue(new TextEncoder().encode('{"field":"icon","error":"unavailable"}\n')); controller.close();
    await promise; expect(update).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ signal, cache: 'no-store', redirect: 'error' });
    expect(String(fetcher.mock.calls[0]![0])).toContain('field=both');
  });
  it('reports permission failures without parsing or displaying upstream bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret upstream error', { status: 403 })));
    const update = vi.fn();
    await expect(streamArtworkSearch('12345678901234567', { gameKey: 'name:valheim', source: 'igdb', query: 'Valheim' }, new AbortController().signal, update)).rejects.toThrow('Недостатньо прав.');
    expect(update).not.toHaveBeenCalled();
  });
});
