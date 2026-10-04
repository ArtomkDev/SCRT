import { describe, expect, it, vi } from 'vitest';
import type { Firestore, QuerySnapshot } from 'firebase-admin/firestore';
import { ActivityArtworkRepository } from './activity-artwork';

function database() {
  const callbacks = new Map<string, (snapshot: QuerySnapshot) => void>();
  const stops = new Map<string, ReturnType<typeof vi.fn>>();
  const subscriptions: Array<{ path: string; order: [string, string]; limit: number }> = [];
  const db = {
    collection: (name: string) => ({ doc: (guildId: string) => ({ collection: (collection: string) => {
      const path = `${name}/${guildId}/${collection}`;
      return { path, orderBy: (field: string, direction: string) => ({ limit: (limit: number) => ({
        onSnapshot: (next: (snapshot: QuerySnapshot) => void) => {
          subscriptions.push({ path, order: [field, direction], limit });
          callbacks.set(path, next);
          const stop = vi.fn(); stops.set(path, stop); return stop;
        },
      }) }) };
    } }) }),
  } as unknown as Firestore;
  return { db, stops, subscriptions, emit: (guildId: string, changed: boolean) => callbacks.get(`guilds/${guildId}/activityArtwork`)?.({ docChanges: () => changed ? [{}] : [] } as unknown as QuerySnapshot) };
}

const guildId = '12345678901234567';
const otherGuild = '32345678901234567';

describe('artwork change subscriptions', () => {
  it('reconciles the initial render gap, shares a bounded guild query and releases the last listener', () => {
    const store = database();
    const first = vi.fn(); const second = vi.fn(); const fail = vi.fn();
    const stopFirst = new ActivityArtworkRepository(store.db).watch(guildId, first, fail);
    store.emit(guildId, false);
    expect(first).toHaveBeenCalledExactlyOnceWith('artwork');
    const stopSecond = new ActivityArtworkRepository(store.db).watch(guildId, second, fail);
    expect(second).toHaveBeenCalledExactlyOnceWith('artwork');
    expect(store.subscriptions).toEqual([{ path: `guilds/${guildId}/activityArtwork`, order: ['updatedAt', 'desc'], limit: 50 }]);
    store.emit(guildId, false);
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
    store.emit(guildId, true);
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
    stopFirst();
    expect(store.stops.get(`guilds/${guildId}/activityArtwork`)).not.toHaveBeenCalled();
    store.emit(guildId, true);
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(3);
    stopSecond();
    expect(store.stops.get(`guilds/${guildId}/activityArtwork`)).toHaveBeenCalledOnce();
  });

  it('isolates guild notifications and rejects invalid guilds before subscribing', () => {
    const store = database(); const repo = new ActivityArtworkRepository(store.db);
    const first = vi.fn(); const second = vi.fn();
    expect(() => repo.watch('invalid', first, vi.fn())).toThrow();
    expect(store.subscriptions).toHaveLength(0);
    const stopFirst = repo.watch(guildId, first, vi.fn());
    const stopSecond = repo.watch(otherGuild, second, vi.fn());
    store.emit(guildId, true);
    expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
    store.emit(otherGuild, true);
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
    stopFirst(); stopSecond();
  });
});
