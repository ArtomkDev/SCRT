import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtworkLookupCache } from './lookup-cache';
afterEach(() => vi.useRealTimers());
describe('public game search cache', () => {
  it('shares in-flight metadata between fields, expires it and does not retain failures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cache = new ArtworkLookupCache<string>();
    let resolve!: (value: string) => void;
    const lookup = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = cache.get('game', lookup); const second = cache.get('game', lookup);
    expect(second).toBe(first); expect(lookup).toHaveBeenCalledOnce();
    resolve('metadata'); expect(await second).toBe('metadata');
    vi.setSystemTime(Date.now() + 300_001);
    await expect(cache.get('game', async () => { throw new Error('temporary'); })).rejects.toThrow('temporary');
    expect(await cache.get('game', async () => 'fresh')).toBe('fresh');
  });
});
