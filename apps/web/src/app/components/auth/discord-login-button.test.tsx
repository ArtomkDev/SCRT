// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordLoginButton } from './discord-login-button';

vi.stubGlobal('React', React);
afterEach(cleanup);

describe('canonical Discord login navigation', () => {
  it('shows pending immediately, blocks repeated clicks and resets when returning', () => {
    render(<DiscordLoginButton />);
    const link = screen.getByRole('link', { name: 'Увійти через Discord' });
    expect(link.getAttribute('href')).toBe('/api/auth/login');
    expect(link.getAttribute('aria-disabled')).toBeNull();
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(link.textContent).toBe('Переходимо до Discord…');
    expect(link.getAttribute('aria-busy')).toBe('true');
    expect(fireEvent.click(link)).toBe(false);
    fireEvent(window, new Event('pageshow'));
    expect(link.getAttribute('aria-disabled')).toBeNull();
    expect(link.textContent).toBe('Увійти через Discord');
  });
  it('preserves modified navigation without leaving the current page pending', () => {
    render(<DiscordLoginButton retry />);
    const link = screen.getByRole('link', { name: 'Спробувати ще раз через Discord' });
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(link.getAttribute('aria-busy')).toBeNull();
  });
});
