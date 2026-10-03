import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({ requireGuildAccess: vi.fn(), redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.requireGuildAccess }));

import GuildHome from './page';

const guildId = '12345678901234567';
describe('server entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it('opens Voice when the user can view it', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['voice.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).rejects.toThrow(`redirect:/servers/${guildId}/voice`);
  });

  it('opens Activity when Voice is unavailable', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['activity.view', 'settings.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).rejects.toThrow(`redirect:/servers/${guildId}/activity`);
  });

  it('opens access control when Voice and Activity are unavailable', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['settings.view']) });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).rejects.toThrow(`redirect:/servers/${guildId}/settings/access-control`);
  });

  it('shows an honest empty state when no module is available', async () => {
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set() });
    await expect(GuildHome({ params: Promise.resolve({ guildId }) })).resolves.toMatchObject({ type: 'main' });
  });
});
