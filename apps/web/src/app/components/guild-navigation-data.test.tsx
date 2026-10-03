import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);
const mocks = vi.hoisted(() => ({ list: vi.fn(), rethrow: vi.fn() }));
vi.mock('@/lib/guards', () => ({ manageableGuildList: mocks.list }));
vi.mock('next/navigation', () => ({ unstable_rethrow: mocks.rethrow, usePathname: () => '/servers', useRouter: () => ({ refresh: vi.fn() }) }));

import { GuildNavigationData } from './guild-navigation-data';

describe('server-loaded guild navigation', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());
  it('projects only safe guild presentation fields from the canonical authorized list', async () => {
    mocks.list.mockResolvedValue({ list: [{ id: '12345678901234567', name: 'Server', icon: null, owner: true, permissions: 'secret-permission-field', token: 'secret-token-field' }], installedIds: new Set() });
    const element = await GuildNavigationData({ development: false });
    expect(element.props.groups.available).toEqual([{ id: '12345678901234567', name: 'Server', icon: null, installed: false }]);
    const html = renderToStaticMarkup(element);
    expect(html).toContain('/api/install/12345678901234567');
    expect(html).not.toContain('secret-');
  });
  it('keeps home and retry controls available after an upstream failure without leaking details', async () => {
    mocks.list.mockRejectedValue(new Error('secret upstream response'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const html = renderToStaticMarkup(await GuildNavigationData({ development: false }));
    expect(html).toContain('href="/servers"');
    expect(html).toContain('Повторити завантаження серверів');
    expect(html).not.toContain('secret');
    expect(log).toHaveBeenCalledWith('Dashboard guild navigation could not load.');
  });
  it('preserves authentication redirects and framework-controlled errors', async () => {
    const redirect = new Error('NEXT_REDIRECT');
    mocks.list.mockRejectedValue(redirect);
    mocks.rethrow.mockImplementation((error) => { throw error; });
    await expect(GuildNavigationData({ development: false })).rejects.toBe(redirect);
  });
});
