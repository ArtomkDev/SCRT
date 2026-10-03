// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNavigationNetworkError, recoverNavigationNetworkError } from './navigation-recovery';

const stops: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); sessionStorage.clear(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); });
afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.restoreAllMocks(); vi.useRealTimers(); });
const start = (reload = vi.fn(), error = new TypeError('network error')) => { stops.push(recoverNavigationNetworkError(error, reload)); return reload; };

describe('broken navigation recovery', () => {
  it.each(['network error', 'Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'])('recovers the browser fetch error %s', async (message) => {
    const reload = start(vi.fn(), new TypeError(message)); await vi.advanceTimersByTimeAsync(300); expect(reload).toHaveBeenCalledOnce();
  });
  it('ignores server digests, programming errors and intentional aborts', () => {
    expect(isNavigationNetworkError(Object.assign(new TypeError('network error'), { digest: '123' }))).toBe(false);
    expect(isNavigationNetworkError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    const reload = vi.fn(); stops.push(recoverNavigationNetworkError(new DOMException('network error', 'AbortError'), reload)); vi.runAllTimers(); expect(reload).not.toHaveBeenCalled();
  });
  it('waits for both visible tab and network connectivity', async () => {
    vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden')!.get!).mockReturnValue(true);
    vi.mocked(Object.getOwnPropertyDescriptor(navigator, 'onLine')!.get!).mockReturnValue(false);
    const reload = start(); await vi.advanceTimersByTimeAsync(300); expect(reload).not.toHaveBeenCalled();
    vi.mocked(Object.getOwnPropertyDescriptor(navigator, 'onLine')!.get!).mockReturnValue(true); window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(300); expect(reload).not.toHaveBeenCalled();
    vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden')!.get!).mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(300); expect(reload).toHaveBeenCalledOnce();
  });
  it('persists the retry budget across mounts and ignores repeated resume events', async () => {
    const reload = start(); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(300); expect(reload).toHaveBeenCalledOnce();
    const second = start(); await vi.advanceTimersByTimeAsync(300); expect(second).not.toHaveBeenCalled();
    vi.setSystemTime(161_000); window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(300);
    // Even multiple mounted listeners share one browser-session allowance.
    expect(reload.mock.calls.length + second.mock.calls.length).toBe(2);
  });
  it('keeps manual recovery when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    const reload = start(); await vi.advanceTimersByTimeAsync(300); expect(reload).not.toHaveBeenCalled();
  });
  it('cancels a pending retry on unmount without consuming the retry budget', async () => {
    const reload = start(); stops.pop()!(); await vi.advanceTimersByTimeAsync(300); expect(reload).not.toHaveBeenCalled();
    const next = start(); await vi.advanceTimersByTimeAsync(300); expect(next).toHaveBeenCalledOnce();
  });
});
