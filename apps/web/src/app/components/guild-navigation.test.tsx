// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupGuilds } from '@/lib/guild-presentation';
import type { DiscordGuild } from '@scrt/discord';

vi.stubGlobal('React', React);
const mocks = vi.hoisted(() => ({ pathname: vi.fn(), search: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: mocks.pathname, useSearchParams: mocks.search, useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./prefetch-link', () => ({ PrefetchLink: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));

import { GuildNavigation } from './guild-navigation';
import { GuildIcon } from './guild-icon';
import { UnsavedChangesProvider, useUnsavedChanges } from './unsaved-changes';

const guild = (id: string, name: string): DiscordGuild => ({ id, name, icon: null, owner: true, permissions: '0' });
const a = '12345678901234567', b = '22345678901234567', c = '32345678901234567', d = '42345678901234567';
const groups = groupGuilds([guild(b, 'Бета'), guild(c, 'Явір'), guild(a, 'Альфа'), guild(d, 'Вежа')], new Set([a, b]));

describe('guild navigation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.pathname.mockReturnValue(`/servers/${b}/activity/games/name%3Adota`); mocks.search.mockReturnValue(new URLSearchParams('period=7d')); });
  afterEach(cleanup);

  it('preserves the screen and period in both switchers while keeping installation destinations', () => {
    render(<GuildNavigation groups={groups} />);
    const rail = screen.getByRole('navigation', { name: 'Перемикання серверів' });
    const links = within(rail).getAllByRole('link');
    const destination = `/servers/${a}?period=7d&screen=activity%2Fgames%2Fname%253Adota`;
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/servers', destination, `/servers/${b}/activity/games/name%3Adota?period=7d`, `/api/install/${d}`, `/api/install/${c}`]);
    expect(within(screen.getByRole('navigation', { name: 'Сервери' })).getByRole('link', { name: /Альфа/ }).getAttribute('href')).toBe(destination);
    expect(within(rail).getByRole('link', { name: 'Бета' }).getAttribute('aria-current')).toBe('page');
    expect(within(rail).getByRole('link', { name: 'Альфа' }).getAttribute('aria-current')).toBeNull();
    expect(within(rail).getByRole('link', { name: 'Додати SCRT до сервера Вежа' }).getAttribute('aria-disabled')).toBeNull();
    expect(rail.textContent).not.toContain('Бета');
  });

  it('shows accessible tooltips on keyboard focus outside the scrolling rail and dismisses with Escape', () => {
    render(<GuildNavigation groups={groups} />);
    const rail = screen.getByRole('navigation', { name: 'Перемикання серверів' });
    const add = within(rail).getByRole('link', { name: 'Додати SCRT до сервера Вежа' });
    fireEvent.focus(add);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Додати SCRT до Вежа');
    expect(add.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(rail.contains(tooltip)).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps home usable without guilds and allows retry alongside the current guild on errors', () => {
    render(<GuildNavigation groups={{ installed: [], available: [] }} unavailable />);
    const rail = screen.getByRole('navigation', { name: 'Перемикання серверів' });
    expect(within(rail).getByRole('link', { name: 'Усі сервери' }).getAttribute('href')).toBe('/servers');
    expect(within(rail).getByRole('link', { name: 'Поточний сервер' }).getAttribute('href')).toBe(`/servers/${b}/activity/games/name%3Adota?period=7d`);
    fireEvent.click(within(rail).getByRole('button', { name: 'Повторити завантаження серверів' }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('opens the mobile picker with both groups and returns focus after Escape', () => {
    render(<GuildNavigation groups={groups} />);
    const details = document.querySelector<HTMLDetailsElement>('.mobile-guild-switcher')!;
    const summary = details.querySelector('summary')!;
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    const picker = within(details).getByRole('navigation', { name: 'Сервери' });
    expect(picker.textContent).toContain('Підключені');
    expect(picker.textContent).toContain('Доступні для підключення');
    expect(within(picker).getByRole('link', { name: 'Додати SCRT до сервера Явір' }).getAttribute('href')).toBe(`/api/install/${c}`);
    fireEvent.keyDown(details, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('blocks repeated installation clicks until the browser returns', () => {
    render(<GuildNavigation groups={groups} />);
    const add = within(screen.getByRole('navigation', { name: 'Перемикання серверів' })).getByRole('link', { name: 'Додати SCRT до сервера Вежа' });
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(add);
    expect(add.getAttribute('aria-busy')).toBe('true');
    expect(fireEvent.click(add)).toBe(false);
    fireEvent(window, new Event('pageshow'));
    expect(add.getAttribute('aria-disabled')).toBeNull();
  });

  it('preserves the unsaved-changes guard when switching guilds or starting installation', () => {
    function DirtyForm() {
      const { setDirty } = useUnsavedChanges();
      React.useEffect(() => { setDirty('test', { save: vi.fn(), discard: vi.fn() }); }, [setDirty]);
      return null;
    }
    render(<UnsavedChangesProvider><GuildNavigation groups={groups} /><DirtyForm /></UnsavedChangesProvider>);
    const rail = screen.getByRole('navigation', { name: 'Перемикання серверів' });
    expect(fireEvent.click(within(rail).getByRole('link', { name: 'Альфа' }))).toBe(false);
    const add = within(rail).getByRole('link', { name: 'Додати SCRT до сервера Вежа' });
    expect(fireEvent.click(add)).toBe(false);
    expect(add.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Зміни не збережено');
  });

  it('uses small icons and recovers from an image error when the source changes', () => {
    const view = render(<GuildIcon id={a} name="SCB Team" icon="first" size={44} />);
    expect(screen.getByRole('img').getAttribute('src')).toContain('size=64');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').textContent).toBe('ST');
    view.rerender(<GuildIcon id={b} name="Other Team" icon="second" size={44} />);
    expect(screen.getByRole('img').getAttribute('src')).toContain('second.webp');
  });
});
