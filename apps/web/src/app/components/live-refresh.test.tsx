// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), dirty: false, pathname: '/servers/123/voice/rooms' }));
const router = { refresh: mocks.refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => mocks.pathname }));
vi.mock('./unsaved-changes', () => ({ useUnsavedChanges: () => ({ hasChanges: mocks.dirty }) }));
import { LiveRefresh } from './live-refresh';

class Events extends EventTarget {
  static instances: Events[] = [];
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { super(); Events.instances.push(this); }
  emit(kind: string, data = '') { act(() => this.dispatchEvent(new MessageEvent(kind, { data }))); }
  fail() { act(() => this.onerror?.()); }
}
const latest = () => Events.instances.at(-1)!;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
let hidden = false;
let online = true;
function visibility(value: boolean) { hidden = value; act(() => document.dispatchEvent(new Event('visibilitychange'))); }
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}
function Content({ value }: { value: Promise<string> | null }) {
  return <section><h2>Активні кімнати</h2><span>{value ? React.use(value) : 'Попередні дані'}</span><button>Доступна дія</button></section>;
}
function PendingPage({ request }: { request: Promise<string> }) {
  const [value, setValue] = React.useState<Promise<string> | null>(null);
  mocks.refresh.mockImplementation(() => setValue(request));
  return <><LiveRefresh endpoint="/events" /><React.Suspense fallback={<p>Прихована верстка</p>}><Content value={value} /></React.Suspense></>;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  mocks.refresh.mockReset(); mocks.dirty = false; mocks.pathname = '/servers/123/voice/rooms';
  hidden = false; online = true; Events.instances = [];
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.stubGlobal('EventSource', Events);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.stubGlobal('React', React); });

describe('live dashboard refresh lifecycle', () => {
  it('merges event bursts and keeps revealed content interactive until a slow refresh completes', async () => {
    const request = deferred();
    render(<PendingPage request={request.promise} />);
    latest().emit('sync');
    for (let index = 0; index < 100; index++) latest().emit('change', 'rooms');
    await advance(1500);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText('Попередні дані')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Доступна дія' })).toBeTruthy();
    expect(screen.queryByText('Прихована верстка')).toBeNull();
    expect(screen.getByText('Оновлення даних…')).toBeTruthy();
    for (let index = 0; index < 100; index++) latest().emit('change', 'rooms');
    await advance(30_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await act(async () => { request.resolve('Нові дані'); await request.promise; });
    expect(screen.getByText('Нові дані')).toBeTruthy();
    await advance(400);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('pauses connections and pending refresh timers while hidden, then reconciles without waiting for sync', async () => {
    render(<LiveRefresh endpoint="/events" />);
    const old = latest(); old.emit('sync'); old.emit('change', 'rooms');
    visibility(true);
    expect(old.close).toHaveBeenCalledOnce();
    old.emit('change', 'rooms'); old.fail();
    await advance(60_000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(Events.instances).toHaveLength(1);
    visibility(false);
    expect(Events.instances).toHaveLength(2);
    await advance(400);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('coalesces visibility, focus, and reconnect sync instead of refreshing the route three times', async () => {
    render(<LiveRefresh endpoint="/events" />);
    latest().emit('sync'); visibility(true); await advance(60_000); visibility(false);
    act(() => window.dispatchEvent(new Event('focus')));
    await advance(400);
    latest().emit('sync');
    await advance(3000);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('defers updates while a form is dirty and still respects hidden-tab suspension after discard', async () => {
    mocks.dirty = true;
    const page = render(<LiveRefresh endpoint="/events" />);
    latest().emit('change', 'rooms'); await advance(3000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    visibility(true); mocks.dirty = false; page.rerender(<LiveRefresh endpoint="/events" />);
    await advance(3000); expect(mocks.refresh).not.toHaveBeenCalled();
    visibility(false); await advance(400);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('does not refresh pages for unrelated voice events', async () => {
    mocks.pathname = '/servers/123/activity/messages';
    render(<LiveRefresh endpoint="/events" />);
    latest().emit('change', 'rooms'); await advance(3000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    latest().emit('change', 'access'); await advance(400);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('does not confuse activity Voice analytics with voice channel management', async () => {
    mocks.pathname = '/servers/123/activity/voice';
    render(<LiveRefresh endpoint="/events" />);
    latest().emit('change', 'rooms'); latest().emit('change', 'creators');
    await advance(3000);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('subscribes to voice documents only on voice management pages', () => {
    mocks.pathname = '/servers/123/activity/games';
    const page = render(<LiveRefresh endpoint="/api/guilds/123/events" />);
    expect(latest().url).toBe('/api/guilds/123/events?scope=activity');
    const old = latest(); mocks.pathname = '/servers/123/voice/rooms';
    page.rerender(<LiveRefresh endpoint="/api/guilds/123/events" />);
    expect(old.close).toHaveBeenCalledOnce();
    expect(latest().url).toBe('/api/guilds/123/events?scope=voice');
  });

  it.each(['/servers/123/activity', '/servers/123/activity/games', '/servers/123/activity/games/name%3Avalheim', '/servers/123/activity/members/456', '/servers/123/activity/settings'])('automatically reconciles artwork changes on %s', async (pathname) => {
    mocks.pathname = pathname;
    render(<LiveRefresh endpoint="/api/guilds/123/events" />);
    latest().emit('sync');
    latest().emit('change', 'artwork');
    latest().emit('change', 'artwork');
    await advance(1500);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('ignores artwork events on activity pages without artwork', async () => {
    mocks.pathname = '/servers/123/activity/messages';
    render(<LiveRefresh endpoint="/api/guilds/123/events" />);
    expect(latest().url).toBe('/api/guilds/123/events?scope=guild');
    latest().emit('change', 'artwork');
    await advance(3000);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('backs off even when each faulty connection sends sync before failing', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<LiveRefresh endpoint="/events" />);
    latest().emit('sync'); latest().fail(); await advance(1000);
    latest().emit('sync'); latest().fail(); await advance(1000);
    expect(Events.instances).toHaveLength(2);
    await advance(1000); expect(Events.instances).toHaveLength(3);
    latest().emit('sync'); latest().fail(); await advance(3000);
    expect(Events.instances).toHaveLength(3);
    await advance(1000); expect(Events.instances).toHaveLength(4);
  });

  it('ignores callbacks from closed sources and reconnects only once after a stream fault', async () => {
    render(<LiveRefresh endpoint="/events" />);
    const old = latest(); old.emit('fault'); old.fail();
    await advance(1500);
    expect(Events.instances).toHaveLength(2);
    old.emit('sync'); old.emit('change', 'rooms'); old.fail(); await advance(3000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(Events.instances).toHaveLength(2);
    expect(screen.queryByText('Автооновлення')).toBeNull();
    latest().emit('sync'); expect(screen.getByText('Автооновлення')).toBeTruthy();
  });

  it('stops offline work and resumes with one update when the network returns', async () => {
    render(<LiveRefresh endpoint="/events" />);
    latest().emit('change', 'rooms');
    online = false; act(() => window.dispatchEvent(new Event('offline')));
    await advance(60_000); expect(mocks.refresh).not.toHaveBeenCalled();
    online = true; act(() => window.dispatchEvent(new Event('online')));
    await advance(400); expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(Events.instances).toHaveLength(2);
  });

  it('reconciles a page restored from the browser cache', async () => {
    render(<LiveRefresh endpoint="/events" />);
    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await advance(1500); expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('releases timers and ignores events after unmount', async () => {
    const page = render(<LiveRefresh endpoint="/events" />);
    const old = latest(); old.emit('change', 'rooms'); page.unmount(); old.fail(); old.emit('sync');
    await advance(60_000);
    expect(old.close).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
