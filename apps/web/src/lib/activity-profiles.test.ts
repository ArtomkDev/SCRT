import { describe, expect, it, vi } from 'vitest';
import type { ActivityProfile } from '@scrt/shared';
import { activityProfileReader } from './activity-profiles';

const guildId = '12345678901234567';
const first = '22345678901234567';
const second = '32345678901234567';
const profile = (userId: string): ActivityProfile => ({ userId, displayName: userId, username: userId, avatarUrl: '', searchName: userId, updatedAt: 1 });

describe('request-scoped Activity profile loading', () => {
  it('batches ready tables and reads their shared members only once', async () => {
    const load = vi.fn(async (_guild: string, ids: string[]) => ids.map(profile));
    const read = activityProfileReader(load);
    const [a, b] = await Promise.all([read(guildId, [first]), read(guildId, [first, second])]);
    expect(a).toEqual([profile(first)]);
    expect(b).toEqual([profile(first), profile(second)]);
    expect(load).toHaveBeenCalledExactlyOnceWith(guildId, [first, second]);
  });

  it('finishes a ready table while a later profile batch is still loading', async () => {
    let finishFirst!: (rows: ActivityProfile[]) => void;
    let finishLater!: (rows: ActivityProfile[]) => void;
    const load = vi.fn().mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; })).mockReturnValueOnce(new Promise((resolve) => { finishLater = resolve; }));
    const read = activityProfileReader(load);
    const a = read(guildId, [first]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const b = read(guildId, [second]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    let laterReady = false;
    void b.then(() => { laterReady = true; });
    finishFirst([profile(first)]);
    await expect(a).resolves.toEqual([profile(first)]);
    expect(laterReady).toBe(false);
    finishLater([profile(second)]);
    await b;
  });

  it('keeps the same member isolated between guilds', async () => {
    const other = '42345678901234567';
    const load = vi.fn(async (guild: string, ids: string[]) => ids.map((id) => ({ ...profile(id), displayName: guild })));
    const read = activityProfileReader(load);
    const [a, b] = await Promise.all([read(guildId, [first]), read(other, [first])]);
    expect(a[0]?.displayName).toBe(guildId);
    expect(b[0]?.displayName).toBe(other);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid IDs before starting a batch and handles absent profiles', async () => {
    const load = vi.fn().mockResolvedValue([]);
    const read = activityProfileReader(load);
    await expect(read(guildId, [first, '../other'])).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
    await expect(read(guildId, [first])).resolves.toEqual([]);
  });

  it('rejects every waiter when its database read fails', async () => {
    const read = activityProfileReader(vi.fn().mockRejectedValue(new Error('Database unavailable')));
    await expect(Promise.all([read(guildId, [first]), read(guildId, [second])])).rejects.toThrow('Database unavailable');
  });
});
