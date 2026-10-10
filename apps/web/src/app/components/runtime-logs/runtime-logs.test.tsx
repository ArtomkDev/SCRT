// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuntimeLogs } from './runtime-logs';
import { RuntimeLogsButton, RuntimeLogsProvider, RuntimeLogsWorkspace } from './runtime-logs-panel';
vi.stubGlobal('React', React);
const snapshot = (runId: string, sequence: number, message: string) => ({ runId, startedAt: '2026-10-10T10:00:00Z', dropped: 0, entries: [{ sequence, time: '2026-10-10T10:01:00Z', level: 'error', module: 'media', action: 'test', message, context: {} }] });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.stubGlobal('React', React); });
it('polls incrementally, filters errors, pauses, and replaces previous-run records after restart', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ web: snapshot('web', 1, 'web ready'), bot: snapshot('bot-a', 1, 'track first failed'), botError: null }))
    .mockResolvedValueOnce(Response.json({ web: { ...snapshot('web', 1, ''), entries: [] }, bot: snapshot('bot-a', 2, 'track second failed'), botError: null }))
    .mockResolvedValueOnce(Response.json({ web: { ...snapshot('web', 1, ''), entries: [] }, bot: snapshot('bot-b', 1, 'worker restarted'), botError: null }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => { render(<RuntimeLogs />); });
  expect(screen.getByText('track first failed')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(fetch.mock.calls[1]![0]).toContain('botAfter=1');
  expect(screen.getByText('track first failed')).toBeTruthy(); expect(screen.getByText('track second failed')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'second' } });
  expect(screen.queryByText('track first failed')).toBeNull(); expect(screen.getByText('track second failed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Призупинити оновлення' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Відновити оновлення' })); });
  expect(screen.getByText('worker restarted')).toBeTruthy(); expect(screen.queryByText('track first failed')).toBeNull();
});
it('keeps a nonblocking dock inside the shell and retains logs and filters across navigation and reopening', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ web: snapshot('web', 1, 'track failed'), bot: null, botError: null }))
    .mockImplementation(async () => Response.json({ web: { ...snapshot('web', 1, ''), entries: [] }, bot: null, botError: null }));
  vi.stubGlobal('fetch', fetch);
  function Workspace() {
    const [page, setPage] = React.useState('Плеєр');
    return <RuntimeLogsProvider><RuntimeLogsButton /><RuntimeLogsWorkspace><button onClick={() => setPage('Налаштування')}>Перейти в налаштування</button><p>{page}</p></RuntimeLogsWorkspace></RuntimeLogsProvider>;
  }
  const { container } = render(<Workspace />);
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Логи' })); });
  const dock = screen.getByRole('complementary', { name: 'Логи поточного запуску' });
  expect(dock.parentElement?.className).toBe('runtime-logs-workspace');
  expect(container.querySelector('.runtime-logs-workspace')?.getAttribute('data-logs-open')).toBe('true');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'track' } });
  fireEvent.click(screen.getByRole('button', { name: 'Перейти в налаштування' }));
  expect(screen.getByText('Налаштування')).toBeTruthy(); expect(screen.getByText('track failed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Закрити логи' }));
  expect(dock.hasAttribute('inert')).toBe(true); expect(screen.getByRole('button', { name: 'Логи' })).toBe(document.activeElement);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Логи' })); });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('track');
  expect(screen.getByText('track failed')).toBeTruthy(); expect(fetch.mock.calls[1]![0]).toContain('webAfter=1');
  fireEvent.keyDown(dock, { key: 'Escape' }); expect(dock.getAttribute('aria-hidden')).toBe('true');
});
it('preserves bot records through a temporary worker outage', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ web: snapshot('web', 1, 'web ready'), bot: snapshot('bot', 1, 'track failed'), botError: null }))
    .mockResolvedValueOnce(Response.json({ web: { ...snapshot('web', 1, ''), entries: [] }, bot: null, botError: 'Worker недоступний' }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => { render(<RuntimeLogs />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('track failed')).toBeTruthy(); expect(screen.getByRole('alert').textContent).toBe('Worker недоступний');
});
