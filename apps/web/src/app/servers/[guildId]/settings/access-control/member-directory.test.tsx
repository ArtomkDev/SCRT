// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberDirectoryProvider, useMemberDirectory } from './member-directory';

vi.stubGlobal('React', React);
const guildId = '12345678901234567';
const memberId = '22345678901234567';
const member = (username: string) => ({ id: memberId, username, globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/a.png', roleIds: [] });
const snapshot = (username: string) => new Response(JSON.stringify({ kind: 'page', revision: 0, members: [member(username)] }) + '\n' + JSON.stringify({ kind: 'done', revision: 0 }) + '\n');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
class Events extends EventTarget {
  static instances: Events[] = [];
  close = vi.fn();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { super(); Events.instances.push(this); }
  emit(event: unknown) { act(() => this.dispatchEvent(new MessageEvent('change', { data: JSON.stringify(event) }))); }
}
function Directory() {
  const { members, mode, retry } = useMemberDirectory();
  return <section><span>{mode}</span>{members.map((entry) => <p key={entry.id}>{entry.username}</p>)}<button onClick={retry}>Повторити</button></section>;
}
function Page() { return <MemberDirectoryProvider guildId={guildId} scope="full"><Directory /></MemberDirectoryProvider>; }
let hidden = false;
const fetchMock = vi.fn<typeof fetch>();
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const visibility = (value: boolean) => { hidden = value; act(() => document.dispatchEvent(new Event('visibilitychange'))); };
beforeEach(() => {
  vi.useFakeTimers(); hidden = false; Events.instances = []; fetchMock.mockReset();
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('EventSource', Events);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.stubGlobal('React', React); });

describe('member directory suspension', () => {
  it('backs off when streams open successfully but immediately fail', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetchMock.mockResolvedValue(snapshot('Учасник'));
    render(<Page />); await advance(0);
    act(() => { Events.instances[0]!.onopen?.(); Events.instances[0]!.onerror?.(); });
    await advance(1000); expect(Events.instances).toHaveLength(2);
    act(() => { Events.instances[1]!.onopen?.(); Events.instances[1]!.onerror?.(); });
    await advance(1000); expect(Events.instances).toHaveLength(2);
    await advance(1000); expect(Events.instances).toHaveLength(3);
    act(() => { Events.instances[2]!.onopen?.(); });
    await advance(30_000);
    act(() => { Events.instances[2]!.onerror?.(); });
    await advance(1000); expect(Events.instances).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cancels a partial snapshot while hidden and ignores its late result after resuming', async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot('Свіжі дані'));
    render(<Page />);
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    visibility(true); expect(signal.aborted).toBe(true);
    await advance(60_000); expect(fetchMock).toHaveBeenCalledOnce();
    visibility(false); await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(screen.getByText('Свіжі дані')).toBeTruthy();
    await act(async () => { old.resolve(snapshot('Застарілі дані')); await old.promise; });
    expect(screen.queryByText('Застарілі дані')).toBeNull();
    expect(screen.getByText('Свіжі дані')).toBeTruthy();
  });

  it('starts neither a snapshot nor a stream for an initially hidden tab', async () => {
    hidden = true; fetchMock.mockResolvedValue(snapshot('Учасник'));
    render(<Page />); await advance(60_000);
    expect(fetchMock).not.toHaveBeenCalled(); expect(Events.instances).toHaveLength(0);
    visibility(false); await advance(0);
    expect(fetchMock).toHaveBeenCalledOnce(); expect(Events.instances).toHaveLength(1);
    expect(screen.getByText('Учасник')).toBeTruthy();
  });

  it('publishes a buffered member change on resume without downloading the full directory again', async () => {
    fetchMock.mockResolvedValue(snapshot('Початкове ім’я'));
    render(<Page />); await advance(0);
    const old = Events.instances[0]!;
    old.emit({ kind: 'change', revision: 1, change: { kind: 'upsert', member: member('Оновлене ім’я') } });
    visibility(true); await advance(5000);
    expect(screen.getByText('Початкове ім’я')).toBeTruthy();
    old.emit({ kind: 'change', revision: 2, change: { kind: 'remove', memberId } });
    visibility(false); await advance(0);
    Events.instances.at(-1)!.emit({ kind: 'sync', revision: 1 });
    expect(screen.getByText('Оновлене ім’я')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('prevents overlapping revision polls if the server takes longer than a polling interval', async () => {
    const slow = deferred<Response>();
    fetchMock.mockResolvedValueOnce(snapshot('Учасник')).mockReturnValue(slow.promise);
    const page = render(<Page />); await advance(0);
    expect(screen.getByText('directory')).toBeTruthy();
    await advance(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(5 * 60_000); expect(fetchMock).toHaveBeenCalledTimes(2);
    const signal = fetchMock.mock.calls[1]![1]!.signal!;
    page.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { slow.resolve(Response.json({ revision: 1 })); await slow.promise; });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an unchanged directory out of the render queue when the tab resumes', async () => {
    fetchMock.mockResolvedValue(snapshot('Учасник'));
    const commits = vi.fn();
    render(<React.Profiler id="directory" onRender={commits}><Page /></React.Profiler>);
    await advance(0);
    const count = commits.mock.calls.length;
    visibility(true); await advance(60_000); visibility(false);
    Events.instances.at(-1)!.emit({ kind: 'sync', revision: 0 });
    await advance(200);
    expect(commits).toHaveBeenCalledTimes(count);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts a revision poll when the browser is hidden', async () => {
    const slow = deferred<Response>();
    fetchMock.mockResolvedValueOnce(snapshot('Учасник')).mockReturnValue(slow.promise);
    render(<Page />); await advance(0); await advance(5 * 60_000);
    const signal = fetchMock.mock.calls[1]![1]!.signal!;
    visibility(true); expect(signal.aborted).toBe(true);
    await act(async () => { slow.resolve(Response.json({ revision: 1 })); await slow.promise; });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Учасник')).toBeTruthy();
  });
});
