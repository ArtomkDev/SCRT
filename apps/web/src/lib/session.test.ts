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
vi.mock('@scrt/discord', () => ({ refreshTokens: mocks.refreshTokens, discordUser: mocks.discordUser }));

import { createSession, refreshSession } from './session';

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
});
