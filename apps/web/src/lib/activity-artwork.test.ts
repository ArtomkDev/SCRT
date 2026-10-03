import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), getMany: vi.fn(), resolve: vi.fn(), callbacks: [] as Array<() => Promise<void>> }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => mocks.callbacks.push(fn) }));
vi.mock('./guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('./server', () => ({ activityArtworkStore: () => ({ getMany: mocks.getMany }), activityArtworkResolver: () => ({ resolve: mocks.resolve, needsRefresh: (value: { nextRefreshAt: number } | undefined) => !value || value.nextRefreshAt <= Date.now() }) }));
import { activityArtworks } from './activity-artwork';
const guildId = '12345678901234567';
const identities = Array.from({ length: 25 }, (_, i) => ({ gameKey: `name:game ${i}`, displayName: `Game ${i}`, applicationId: null }));
describe('artwork page query behavior', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.callbacks.length = 0; mocks.access.mockResolvedValue({}); mocks.getMany.mockResolvedValue([]); mocks.resolve.mockResolvedValue({}); });
  it('uses a single batch cache read and performs no provider calls before rendering completes', async () => {
    expect(await activityArtworks(guildId, identities)).toEqual([]);
    expect(mocks.getMany).toHaveBeenCalledExactlyOnceWith(guildId, identities.map((item) => item.gameKey));
    expect(mocks.resolve).not.toHaveBeenCalled();
    await mocks.callbacks[0]!(); expect(mocks.resolve).toHaveBeenCalledTimes(25);
  });
  it('renders stale artwork without blocking and schedules only expired entries', async () => {
    const stale = { gameKey: identities[0]!.gameKey, nextRefreshAt: 0 }; const fresh = { gameKey: identities[1]!.gameKey, nextRefreshAt: Date.now() + 60_000 };
    mocks.getMany.mockResolvedValue([stale, fresh]);
    expect(await activityArtworks(guildId, identities.slice(0, 2))).toEqual([stale, fresh]); expect(mocks.resolve).not.toHaveBeenCalled();
    await mocks.callbacks[0]!(); expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(guildId, identities[0]);
  });
  it('authorizes before any private cache read or enrichment', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(activityArtworks(guildId, identities)).rejects.toThrow('Forbidden'); expect(mocks.getMany).not.toHaveBeenCalled(); expect(mocks.callbacks).toHaveLength(0);
  });
});
