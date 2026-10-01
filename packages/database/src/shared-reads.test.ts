import { describe, expect, it, vi } from 'vitest';
import { sharedReads } from './shared-reads';

describe('concurrent database reads', () => {
  it('coalesces 1000 reads while keeping the next authorization read fresh', async () => {
    const read = sharedReads<number>();
    const database = {};
    const fetch = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const values = await Promise.all(Array.from({ length: 1000 }, () => read(database, 'guilds/one/access/roles', fetch)));
    expect(values.every((value) => value === 1)).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(await read(database, 'guilds/one/access/roles', fetch)).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('isolates paths and retries after a rejected read', async () => {
    const read = sharedReads<number>();
    const database = {};
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(2);
    await expect(read(database, 'guilds/one', fetch)).rejects.toThrow('offline');
    expect(await read(database, 'guilds/one', fetch)).toBe(2);
    await Promise.all([read(database, 'guilds/one', fetch), read(database, 'guilds/two', fetch), read({}, 'guilds/one', fetch)]);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('bounds pending unique reads while accepting an existing request', async () => {
    const read = sharedReads<number>();
    const database = {};
    let finish!: (value: number) => void;
    const pending = new Promise<number>((resolve) => { finish = resolve; });
    const requests = Array.from({ length: 512 }, (_, i) => read(database, String(i), () => pending));
    expect(read(database, '0', () => pending)).toBe(requests[0]);
    await expect(read(database, 'overflow', () => pending)).rejects.toThrow('Too many concurrent');
    finish(1);
    await Promise.all(requests);
  });
});
