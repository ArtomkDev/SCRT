import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@scrt/discord', () => ({ botListGuildMembers: list }));

describe('member page cache', () => {
  beforeEach(() => { vi.resetModules(); list.mockReset(); });

  it('serves 1000 simultaneous visitors and subsequent hits with one Discord call', async () => {
    const { cachedGuildMemberPage: page } = await import('./member-directory-cache');
    const members = [{ user: { id: '123456789012345678', username: 'user' }, roles: [] }];
    list.mockResolvedValue(members);
    const results = await Promise.all(Array.from({ length: 1000 }, () => page('bot', 'guild', 1)));
    expect(results.every((result) => result === members)).toBe(true);
    expect(await page('bot', 'guild', 1)).toBe(members);
    expect(list).toHaveBeenCalledOnce();
  });

  it('isolates credentials, guilds, revisions and pagination cursors', async () => {
    const { cachedGuildMemberPage: page } = await import('./member-directory-cache');
    list.mockResolvedValue([]);
    await Promise.all([page('bot', 'one', 1), page('bot', 'two', 1), page('other-bot', 'one', 1), page('bot', 'one', 2), page('bot', 'one', 1, 'after')]);
    expect(list).toHaveBeenCalledTimes(5);
  });

  it('does not cache failed loads and rejects excessive distinct pending scans', async () => {
    const { cachedGuildMemberPage: page } = await import('./member-directory-cache');
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    await expect(page('bot', 'one', 1)).rejects.toThrow('offline');
    await expect(page('bot', 'one', 1)).resolves.toEqual([]);
    let finish!: (value: []) => void;
    // Share one upstream promise to finish every pending request without leaked work.
    const pending = new Promise<[]>((resolve) => { finish = resolve; });
    list.mockReturnValue(pending);
    const requests = Array.from({ length: 32 }, (_, i) => page('bot', String(i), 1));
    await expect(page('bot', 'overflow', 1)).rejects.toThrow('busy');
    finish([]);
    await Promise.all(requests);
  });
});
