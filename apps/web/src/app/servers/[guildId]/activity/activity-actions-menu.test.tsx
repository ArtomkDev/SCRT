// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ ignore: vi.fn(), refreshArtwork: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.stubGlobal('React', React);
vi.mock('./actions', () => ({ setActivityGameIgnored: mocks.ignore }));
vi.mock('./artwork-actions', () => ({ refreshActivityArtwork: mocks.refreshArtwork }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock('@/app/components/prefetch-link', () => ({ PrefetchLink: (props: React.ComponentProps<'a'>) => <a {...props} /> }));
import { ActivityActionsMenu } from './activity-actions-menu';
const guildId = '12345678901234567';
const identity = { gameKey: 'name:valheim', displayName: 'Valheim', applicationId: null };
const href = `/servers/${guildId}/activity/games/name%3Avalheim?period=7d`;
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
describe('activity actions and permissions', () => {
  it('gives a read-only viewer only details/players, preserves period and supports keyboard focus', () => {
    render(<ActivityActionsMenu guildId={guildId} identity={identity} href={href} canManage={false} />);
    const trigger = screen.getByRole('button', { name: 'Дії: Valheim' });
    fireEvent.click(trigger);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getByRole('menuitem', { name: 'Відкрити' }).getAttribute('href')).toBe(href);
    expect(screen.getByRole('menuitem', { name: 'Гравці' }).getAttribute('href')).toBe(href + '#contributors');
    expect(screen.queryByRole('menuitem', { name: 'Оформлення' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Ігнорувати' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Відкрити' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Гравці' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it.each([false, true])('allows managers to ignore/restore with the existing guild-scoped action (ignored=%s)', async (ignored) => {
    mocks.ignore.mockResolvedValue(undefined);
    render(<ActivityActionsMenu guildId={guildId} identity={identity} href={href} canManage ignored={ignored} />);
    fireEvent.click(screen.getByRole('button', { name: 'Дії: Valheim' }));
    expect(screen.getByRole('menuitem', { name: 'Оформлення' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: ignored ? 'Відстежувати активність' : 'Ігнорувати' }));
    await waitFor(() => expect(mocks.ignore).toHaveBeenCalledOnce());
    const form = mocks.ignore.mock.calls[0]![1] as FormData;
    expect(mocks.ignore.mock.calls[0]![0]).toBe(guildId); expect(form.get('gameKey')).toBe(identity.gameKey); expect(form.get('mode')).toBe(ignored ? 'track' : 'ignore');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull()); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('retains the menu and reports refresh failure without leaking provider errors', async () => {
    mocks.refreshArtwork.mockRejectedValue(new Error('upstream secret'));
    render(<ActivityActionsMenu guildId={guildId} identity={identity} href={href} canManage detail />);
    fireEvent.click(screen.getByRole('button', { name: 'Дії: Valheim' }));
    expect(screen.queryByRole('menuitem', { name: 'Відкрити' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Оновити оформлення автоматично' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Не вдалося виконати дію. Спробуйте ще раз.');
    expect(screen.getByRole('menu')).toBeTruthy(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('returns to the selected-period list after ignoring the activity from its detail page', async () => {
    mocks.ignore.mockResolvedValue(undefined);
    render(<ActivityActionsMenu guildId={guildId} identity={identity} href={href} canManage detail />);
    fireEvent.click(screen.getByRole('button', { name: 'Дії: Valheim' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ігнорувати' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/servers/${guildId}/activity/games?period=7d`));
  });
});
