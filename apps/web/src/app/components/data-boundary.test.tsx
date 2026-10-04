// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { notFound, redirect } from 'next/navigation';
import { DataBoundary } from './data-boundary';

vi.stubGlobal('React', React);
const refresh = vi.fn();
const router: AppRouterInstance = { back: vi.fn(), forward: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh, bfcacheId: 'test' };
function Providers({ children, path = '/servers/123/activity' }: { children: React.ReactNode; path?: string }) {
  return <AppRouterContext value={router}><PathnameContext value={path}>{children}</PathnameContext></AppRouterContext>;
}
function Failure({ fail }: { fail: boolean }) {
  if (fail) throw new TypeError('network error');
  return <p>Завантажена статистика</p>;
}
class FrameworkBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>Framework signal</p> : this.props.children; }
}

beforeEach(() => { refresh.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('local dashboard data recovery', () => {
  it('keeps navigation, adjacent data and form state when a widget fails, then retries its server data', () => {
    let fail = true;
    function Widget() { return <Failure fail={fail} />; }
    refresh.mockImplementation(() => { fail = false; });
    render(<Providers><nav><a href="/servers">Сервери</a></nav><input aria-label="Чернетка" defaultValue="Збережений ввід" /><p>Інший рейтинг</p><DataBoundary title="Показники недоступні"><Widget /></DataBoundary></Providers>);
    expect(screen.getByRole('link', { name: 'Сервери' })).toBeTruthy();
    expect(screen.getByText('Інший рейтинг')).toBeTruthy();
    expect(screen.getByText('Показники недоступні')).toBeTruthy();
    expect(screen.queryByText('network error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторити завантаження' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByText('Завантажена статистика')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Збережений ввід');
  });

  it('contains a rejected asynchronous server payload while leaving the page shell available', async () => {
    let reject!: (error: Error) => void;
    const request = new Promise<string>((_resolve, fail) => { reject = fail; });
    function AsyncData() { return <p>{React.use(request)}</p>; }
    await act(async () => { render(<Providers><h1>Активність</h1><DataBoundary title="Дані недоступні"><React.Suspense fallback={<p>Очікування</p>}><AsyncData /></React.Suspense></DataBoundary><a href="/servers/456/activity">Інший сервер</a></Providers>); });
    await act(async () => { reject(new TypeError('network error')); await request.catch(() => {}); });
    expect(screen.getByText('Активність')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Інший сервер' })).toBeTruthy();
    expect(await screen.findByText('Дані недоступні')).toBeTruthy();
    expect(screen.queryByText('Очікування')).toBeNull();
  });

  it('clears a failed widget when navigating to another server', () => {
    const page = render(<Providers><DataBoundary title="Дані недоступні"><Failure fail /></DataBoundary></Providers>);
    page.rerender(<Providers path="/servers/456/activity"><DataBoundary title="Дані недоступні"><Failure fail={false} /></DataBoundary></Providers>);
    expect(screen.getByText('Завантажена статистика')).toBeTruthy();
  });

  it.each([notFound, () => redirect('/login')])('lets framework navigation signals reach their owning boundary', (signal) => {
    function Signal(): React.ReactNode { return signal(); }
    render(<Providers><FrameworkBoundary><DataBoundary title="Помилка даних"><Signal /></DataBoundary></FrameworkBoundary></Providers>);
    expect(screen.getByText('Framework signal')).toBeTruthy();
    expect(screen.queryByText('Помилка даних')).toBeNull();
  });
});
