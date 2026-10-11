// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaHeader } from './media-header';

const navigation = vi.hoisted(() => ({ pathname: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
const guildId = '12345678901234567', root = `/servers/${guildId}/media`;
beforeEach(() => { vi.stubGlobal('React', React); navigation.pathname = root; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ['', 'Пошук і черга'], ['/favorites', 'Улюблені'], ['/history', 'Історія'],
  ['/settings', 'Налаштування'], ['/sources', 'Джерела'], ['/diagnostics', 'Діагностика'],
  ['/favorites/playlist', 'Улюблені'],
])('marks only the current module screen for %s', (suffix, label) => {
  navigation.pathname = `${root}${suffix}`;
  const { container } = render(<MediaHeader guildId={guildId} />);
  const nav = screen.getByRole('navigation', { name: 'Розділи Медіа' });
  expect(within(nav).getAllByRole('link')).toHaveLength(6);
  expect(within(nav).getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page');
  expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it('updates the active screen without remounting the shared module header', () => {
  const view = render(<MediaHeader guildId={guildId} />);
  navigation.pathname = `${root}/history`; view.rerender(<MediaHeader guildId={guildId} />);
  expect(screen.getByRole('link', { name: 'Історія' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Пошук і черга' }).hasAttribute('aria-current')).toBe(false);
  navigation.pathname = '/servers/22345678901234567/media/history'; view.rerender(<MediaHeader guildId={guildId} />);
  expect(view.container.querySelector('[aria-current]')).toBeNull();
});
