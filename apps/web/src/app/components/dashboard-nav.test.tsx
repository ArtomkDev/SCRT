import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.stubGlobal('React', React);
const mocks = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: mocks.usePathname }));

import { DashboardNav } from './dashboard-nav';

const guildId = '12345678901234567';

describe('server module navigation', () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue(`/servers/${guildId}/activity/games`);
  });

  it('shows and highlights Activity for nested module pages', () => {
    const html = renderToStaticMarkup(<DashboardNav guildId={guildId} showActivity />);
    expect(html).toContain(`href="/servers/${guildId}/activity"`);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Активність');
    expect(html.match(/aria-current="page"/gu)).toHaveLength(1);
    expect(html).not.toContain('Огляд');
    expect(html).not.toContain('>Сервери<');
  });

  it.each(['enabled', 'disabled', 'degraded'] as const)('shows %s status while keeping both modules reachable', (state) => {
    const html = renderToStaticMarkup(<DashboardNav guildId={guildId} showVoice showActivity showAccess voiceState={state} activityState={state} />);
    expect(html.match(new RegExp(`module-status-${state}`, 'gu'))).toHaveLength(2);
    expect(html).toContain(`/servers/${guildId}/activity`);
    expect(html).toContain(`/servers/${guildId}/voice`);
    expect(html).toContain(`/servers/${guildId}/settings/access-control`);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('Огляд');
  });

  it('hides Activity without permission to view it', () => {
    const html = renderToStaticMarkup(<DashboardNav guildId={guildId} showVoice showAccess />);
    expect(html).not.toContain('/activity');
    expect(html).toContain(`/servers/${guildId}/voice`);
    expect(html).toContain(`/servers/${guildId}/settings/access-control`);
  });
});
