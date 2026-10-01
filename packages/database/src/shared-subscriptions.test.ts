import { describe, expect, it, vi } from 'vitest';
import { sharedSubscriptions } from './shared-subscriptions';

describe('shared Firestore listeners', () => {
  it('serves 1000 visitors from one listener, replays current data and releases the last socket', () => {
    const watch = sharedSubscriptions<number>();
    const database = {};
    let emit!: (value: number) => void;
    const stop = vi.fn();
    const start = vi.fn((next: (value: number) => void) => { emit = next; return stop; });
    const values = Array.from({ length: 1000 }, () => vi.fn());
    const stops = values.map((next) => watch(database, 'guilds/one', start, { next, error: vi.fn() }));
    emit(7);
    expect(start).toHaveBeenCalledOnce();
    expect(values.every((next) => next.mock.calls[0]?.[0] === 7)).toBe(true);
    const late = vi.fn();
    const stopLate = watch(database, 'guilds/one', start, { next: late, error: vi.fn() });
    expect(late).toHaveBeenCalledWith(7);
    stops.forEach((unsubscribe) => unsubscribe());
    expect(stop).not.toHaveBeenCalled();
    stopLate(); stopLate();
    expect(stop).toHaveBeenCalledOnce();
    watch(database, 'guilds/one', start, { next: vi.fn(), error: vi.fn() })();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('keeps different guilds and database instances isolated', () => {
    const watch = sharedSubscriptions<number>();
    const database = {};
    const start = vi.fn(() => vi.fn());
    const listener = () => ({ next: vi.fn(), error: vi.fn() });
    const stops = [watch(database, 'guilds/one', start, listener()), watch(database, 'guilds/two', start, listener()), watch({}, 'guilds/one', start, listener())];
    expect(start).toHaveBeenCalledTimes(3);
    stops.forEach((stop) => stop());
  });

  it('fans out failures and starts a fresh subscription after failure', () => {
    const watch = sharedSubscriptions<number>();
    const database = {};
    let fail!: (error: Error) => void;
    const stop = vi.fn();
    const start = vi.fn((_next: (value: number) => void, error: (error: Error) => void) => { fail = error; return stop; });
    const errors = [vi.fn(), vi.fn()];
    const stops = errors.map((error) => watch(database, 'guilds/one', start, { next: vi.fn(), error }));
    const error = new Error('offline');
    fail(error);
    expect(errors.every((callback) => callback.mock.calls[0]?.[0] === error)).toBe(true);
    stops.forEach((unsubscribe) => unsubscribe());
    expect(stop).toHaveBeenCalledOnce();
    watch(database, 'guilds/one', start, { next: vi.fn(), error: vi.fn() })();
    expect(start).toHaveBeenCalledTimes(2);
  });
});
