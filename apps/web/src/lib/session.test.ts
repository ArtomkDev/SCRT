import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    refreshTokens: vi.fn(),
    discordUser: vi.fn(),
    cookies: vi.fn(async () => ({
      get: (name: string) => values.has(name) ? { value: values.get(name) } : undefined,
      set: (name: string, value: string) => { values.set(name, value); },
      delete: (name: string) => { values.delete(name); },
    })),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('./server', () => ({ env: () => ({ SESSION_SECRET: 'test-secret', NODE_ENV: 'test', DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret' }) }));
vi.mock('@scrt/discord', async (importOriginal) => ({ ...await importOriginal<typeof import('@scrt/discord')>(), refreshTokens: mocks.refreshTokens, discordUser: mocks.discordUser }));

import { DiscordApiError } from '@scrt/discord';
import { createSession, hasSession, refreshSession, SessionRefreshUnavailableError } from './session';

describe('session refresh', () => {
  beforeEach(() => {
    mocks.values.clear();
    vi.clearAllMocks();
  });

  it('shares one token rotation across concurrent requests with the same cookie', async () => {
    await createSession({ access_token: 'old', refresh_token: 'old-refresh', expires_in: 0 }, { id: '12345678901234567', username: 'Tester', avatar: null, global_name: null });
    mocks.refreshTokens.mockResolvedValue({ access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600 });
    const results = await Promise.all([refreshSession(), refreshSession()]);
    expect(results).toEqual([true, true]);
    expect(mocks.refreshTokens).toHaveBeenCalledOnce();
  });
  it.each([new DiscordApiError(503), new DiscordApiError(429), new Error('network offline'), new DiscordApiError(400, undefined, 'invalid_client')])('preserves the session after a temporary/configuration failure: %s', async (error) => {
    await createSession({ access_token: 'expired', refresh_token: `retry-${error.message}`, expires_in: 0 }, { id: '12345678901234567', username: 'Tester', avatar: null, global_name: null });
    const original = mocks.values.get('scrt_session');
    mocks.refreshTokens.mockRejectedValueOnce(error);
    await expect(refreshSession()).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
    expect(mocks.values.get('scrt_session')).toBe(original);
    await expect(hasSession()).resolves.toBe(true);
    mocks.refreshTokens.mockResolvedValueOnce({ access_token: 'restored', refresh_token: 'restored-refresh', expires_in: 3600 });
    await expect(refreshSession()).resolves.toBe(true);
    expect(mocks.refreshTokens).toHaveBeenCalledTimes(2);
  });
  it('clears a session only when Discord rejects the refresh grant', async () => {
    await createSession({ access_token: 'expired', refresh_token: 'revoked-refresh', expires_in: 0 }, { id: '12345678901234567', username: 'Tester', avatar: null, global_name: null });
    mocks.refreshTokens.mockRejectedValueOnce(new DiscordApiError(400, undefined, 'invalid_grant'));
    await expect(refreshSession()).resolves.toBe(false);
    await expect(hasSession()).resolves.toBe(false);
  });
});
