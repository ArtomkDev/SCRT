// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardNav } from './dashboard-nav';
import { ScreenHeader } from './dashboard-screen';
import { GuildModuleStatus, GuildModuleStatusProvider, type GuildModule } from './guild-module-status';
import type { ModuleState } from './module-status';
import { MediaHeader } from '../servers/[guildId]/media/media-header';

const guildId = '12345678901234567';
vi.mock('next/navigation', () => ({ usePathname: () => '/servers/12345678901234567/media' }));
beforeEach(() => { vi.stubGlobal('React', React); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Module({ module, state, id = guildId }: { module: GuildModule; state?: ModuleState; id?: string }) {
  return <ScreenHeader title={module} description="Module description" status={<GuildModuleStatus guildId={id} module={module} state={state} />} />;
}

it('reserves the status slot before data arrives and preserves it when a known status replaces grey', () => {
  const view = render(<Module module="media" />);
  const slot = view.container.querySelector('.dashboard-screen-status');
  const heading = screen.getByRole('heading', { name: 'media' });
  expect(slot?.contains(screen.getByText('Статус уточнюється'))).toBe(true);
  expect(slot?.querySelector('.module-status-unknown')).toBeTruthy();
  expect(slot?.querySelector('.module-status')?.getAttribute('aria-busy')).toBe('true');
  view.rerender(<Module module="media" state="enabled" />);
  expect(view.container.querySelector('.dashboard-screen-status')).toBe(slot);
  expect(screen.getByRole('heading', { name: 'media' })).toBe(heading);
  expect(slot?.contains(screen.getByText('Модуль увімкнено'))).toBe(true);
  view.rerender(<ScreenHeader title="Access" description="Module description" />);
  expect(view.container.querySelector('.dashboard-screen-status')).toBeTruthy();
  expect(view.container.querySelector('.dashboard-screen-status')?.textContent).toBe('');
});

it('uses known sidebar statuses as soon as another module header mounts, including during refreshed loading', () => {
  function App({ module, loading = false }: { module: GuildModule; loading?: boolean }) {
    return <GuildModuleStatusProvider guildId={guildId}>
      <DashboardNav guildId={guildId} showVoice showActivity showMedia voiceState={loading ? undefined : 'disabled'} activityState={loading ? undefined : 'enabled'} mediaState={loading ? undefined : 'degraded'} />
      <Module module={module} />
    </GuildModuleStatusProvider>;
  }
  const view = render(<App module="activity" />);
  expect(view.container.querySelector('.dashboard-screen-status')?.textContent).toBe('Модуль увімкнено');
  view.rerender(<App module="voice" />);
  expect(view.container.querySelector('.dashboard-screen-status')?.textContent).toBe('Модуль вимкнено');
  view.rerender(<App module="media" loading />);
  expect(view.container.querySelector('.dashboard-screen-status')?.textContent).toBe('Модуль працює частково');
  expect(view.container.querySelector('.module-status-unknown')).toBeNull();
});

it('shows the cached media status before the persistent player has registered', () => {
  const view = render(<GuildModuleStatusProvider guildId={guildId}>
    <DashboardNav guildId={guildId} showMedia mediaState="disabled" />
    <MediaHeader guildId={guildId} />
  </GuildModuleStatusProvider>);
  expect(view.container.querySelector('.dashboard-screen-status')?.textContent).toBe('Модуль вимкнено');
});

it('shares newer header status with the sidebar without reverting to unchanged initial props', () => {
  function App({ state }: { state?: ModuleState }) {
    return <GuildModuleStatusProvider guildId={guildId}>
      <DashboardNav guildId={guildId} showMedia mediaState="enabled" />
      <Module module="media" state={state} />
    </GuildModuleStatusProvider>;
  }
  const view = render(<App />);
  view.rerender(<App state="degraded" />);
  const nav = screen.getByRole('navigation', { name: 'Розділи сервера' });
  expect(within(nav).getByRole('img', { name: 'Медіа: працює частково' })).toBeTruthy();
  view.rerender(<App state="degraded" />);
  expect(within(nav).queryByRole('img', { name: 'Медіа: увімкнено' })).toBeNull();
});

it('never reuses another guild status, even if the provider is reused without a key', () => {
  const other = '22345678901234567';
  function App({ id, ready = false }: { id: string; ready?: boolean }) {
    return <GuildModuleStatusProvider guildId={id}>
      <DashboardNav guildId={id} showMedia mediaState={ready ? 'enabled' : undefined} />
      <Module id={id} module="media" />
      {id !== guildId && <Module id={guildId} module="voice" />}
    </GuildModuleStatusProvider>;
  }
  const view = render(<App id={guildId} ready />);
  expect(screen.getByText('Модуль увімкнено')).toBeTruthy();
  view.rerender(<App id={other} />);
  expect(screen.queryByText('Модуль увімкнено')).toBeNull();
  expect(screen.getAllByText('Статус уточнюється')).toHaveLength(2);
  view.rerender(<App id={other} ready />);
  expect(screen.getByText('Модуль увімкнено')).toBeTruthy();
  expect(screen.getAllByText('Статус уточнюється')).toHaveLength(1);
});
