import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({ accessToken: vi.fn(), hasSession: vi.fn(), redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.accessToken, hasSession: mocks.hasSession }));

import Home from './page';

describe('landing page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('sends an active session directly to the server list', async () => {
    mocks.accessToken.mockResolvedValue('active-token');
    await expect(Home()).rejects.toThrow('redirect:/servers');
    expect(mocks.hasSession).not.toHaveBeenCalled();
  });

  it('refreshes an existing expired session before entering', async () => {
    mocks.accessToken.mockResolvedValue(null);
    mocks.hasSession.mockResolvedValue(true);
    await expect(Home()).rejects.toThrow('redirect:/api/auth/refresh?next=%2Fservers');
  });

  it('shows the Discord login prompt without a session', async () => {
    mocks.accessToken.mockResolvedValue(null);
    mocks.hasSession.mockResolvedValue(false);
    await expect(Home()).resolves.toMatchObject({ type: 'main' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
