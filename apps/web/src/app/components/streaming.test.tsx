import { Writable } from 'node:stream';
import * as React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityLeaderboardEntry, ActivityTotals } from '@scrt/shared';
import { activitySettingsSchema } from '@scrt/validation';

vi.stubGlobal('React', React);
vi.mock('@/lib/activity-artwork', () => ({ activityArtworks: async () => [], activityArtworkForKey: async () => null, activityArtworkHealth: async () => [], activityArtworkNeedsRefresh: () => true }));
vi.mock('../servers/[guildId]/activity/artwork-actions', () => ({ editActivityArtwork: vi.fn(), refreshActivityArtwork: vi.fn(), resetActivityArtwork: vi.fn(), enrichMissingArtworkBatch: vi.fn() }));
vi.mock('../servers/[guildId]/activity/artwork-picker', () => ({ ArtworkPicker: () => null }));
const mocks = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), list: vi.fn(), settings: vi.fn(), overview: vi.fn(),
  ranking: vi.fn(), profiles: vi.fn(), games: vi.fn(), health: vi.fn(), resources: vi.fn(), observed: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/guards', () => ({ requireSession: mocks.session, requireGuildAccess: mocks.access, manageableGuildList: mocks.list }));
vi.mock('@/lib/activity-data', () => ({
  activitySettings: mocks.settings, activityOverview: mocks.overview,
  activityRanking: mocks.ranking, activityProfiles: mocks.profiles, activityGames: mocks.games,
  activityHealth: mocks.health, activityObservedGames: mocks.observed, activityPeriod: () => 'today',
}));
vi.mock('@/lib/voice-data', () => ({ voiceResources: mocks.resources }));
vi.mock('../servers/[guildId]/activity/actions', () => ({ saveActivitySettings: vi.fn(), setActivityGameIgnored: vi.fn(), enableActivity: vi.fn() }));
vi.mock('./action-form', () => ({ ActionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/servers/12345678901234567/activity', useRouter: () => ({ refresh: vi.fn() }), unstable_rethrow: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
vi.mock('./prefetch-link', () => ({ PrefetchLink: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
vi.mock('./unsaved-changes', () => ({ UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./live-refresh', () => ({ LiveRefresh: () => null }));

import { DashboardShell } from './dashboard-shell';
import GuildLayout from '../servers/[guildId]/layout';
import ActivityLayout from '../servers/[guildId]/activity/layout';
import ActivityOverviewPage from '../servers/[guildId]/activity/page';
import ActivitySettingsPage from '../servers/[guildId]/activity/settings/page';

const guildId = '12345678901234567';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function renderStream(tree: React.ReactNode) {
  let html = '';
  const errors: unknown[] = [];
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) { html += chunk.toString(); done(); } });
  const finished = new Promise<void>((resolve, reject) => { sink.once('finish', resolve); sink.once('error', reject); });
  const stream = renderToPipeableStream(tree, {
    onShellReady() { stream.pipe(sink); },
    onError(error) { errors.push(error); },
  });
  return { html: () => html, errors, finished, abort: () => stream.abort() };
}

describe('dashboard server streaming', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.observed.mockResolvedValue({ games: [], next: null }); mocks.list.mockResolvedValue({ list: [], installedIds: new Set() }); });

  it('sends the dashboard and page shell before session and guild sidebar reads finish', async () => {
    const session = deferred<{ user: { id: string; username: string; global_name: null; avatar: null } }>();
    const access = deferred<{ discordGuild: { name: string; icon: null }; permissions: Set<string> }>();
    mocks.session.mockReturnValue(session.promise);
    mocks.access.mockReturnValue(access.promise);
    const list = deferred<{ list: []; installedIds: Set<string> }>();
    mocks.list.mockReturnValue(list.promise);
    const output = renderStream(<DashboardShell><GuildLayout params={Promise.resolve({ guildId })}><h1>Ready page shell</h1></GuildLayout></DashboardShell>);
    try {
      await vi.waitFor(() => expect(output.html()).toContain('<h1>Ready page shell</h1>'));
      expect(output.html()).toContain('SCRT');
      expect(output.html()).toContain('Завантаження профілю');
      expect(output.html()).toContain('Завантаження сервера');
      expect(output.html()).toContain('Завантаження серверів');
      expect(output.html()).not.toContain('Private guild name');

      access.resolve({ discordGuild: { name: 'Private guild name', icon: null }, permissions: new Set(['activity.view']) });
      await vi.waitFor(() => expect(output.html()).toContain('Private guild name'));
      expect(output.html()).not.toContain('Signed-in username');
      session.resolve({ user: { id: guildId, username: 'Signed-in username', global_name: null, avatar: null } });
      list.resolve({ list: [], installedIds: new Set() });
      await output.finished;
      expect(output.html()).toContain('Signed-in username');
      expect(output.errors).toEqual([]);
    } finally { output.abort(); }
  });

  it('sends Activity headings and tabs immediately, then streams enabled analytics independently', async () => {
    const settings = deferred<{ enabled: boolean; streak: { timezone: string; minimumVoiceSecondsPerDay: number } }>();
    const overview = deferred<ActivityTotals & { activeMembers: number }>();
    const chat = deferred<ActivityLeaderboardEntry[]>();
    const slowRankings = deferred<ActivityLeaderboardEntry[]>();
    const games = deferred<[]>();
    mocks.settings.mockReturnValue(settings.promise);
    mocks.overview.mockReturnValue(overview.promise);
    mocks.ranking.mockImplementation((_guildId, metric) => metric === 'messages' ? chat.promise : slowRankings.promise);
    mocks.games.mockReturnValue(games.promise);
    mocks.profiles.mockResolvedValue([{ userId: guildId, displayName: 'Ready chat member' }]);
    const params = Promise.resolve({ guildId });
    const page = await ActivityOverviewPage({ params, searchParams: Promise.resolve({}) });
    const layout = await ActivityLayout({ params, children: page });
    const output = renderStream(layout);
    try {
      await vi.waitFor(() => expect(output.html()).toContain('<h1>Активність</h1>'));
      expect(output.html()).toContain(`href="/servers/${guildId}/activity/messages"`);
      expect(output.html()).toContain('Перевірка стану активності');
      expect(output.html()).toContain('<h2>Огляд</h2>');
      expect(output.html()).toContain('<dt>Повідомлення</dt>');
      expect(output.html()).toContain('<dt>Активні учасники</dt>');
      expect(output.html()).toContain('<h3>Найактивніші в чаті</h3>');
      expect(output.html()).toContain('<th>Активність</th>');
      expect(output.html()).not.toContain('skeleton-card');
      expect(mocks.overview).not.toHaveBeenCalled();
      settings.resolve({ enabled: true, streak: { timezone: 'Europe/Kyiv', minimumVoiceSecondsPerDay: 300 } });
      await vi.waitFor(() => expect(output.html()).toContain('Найактивніші в чаті'));
      expect(output.html()).toContain('Найактивніші в чаті');
      expect(output.html()).toContain('Завантаження рейтингу');
      expect(output.html()).toContain('Завантаження активностей');
      expect(output.html()).not.toContain('<dd>123</dd>');

      overview.resolve({ messages: 123, voiceSeconds: 0, streamSeconds: 0, activeMembers: 4 });
      await vi.waitFor(() => expect(output.html()).toContain('<dd>123</dd>'));
      expect(output.html()).not.toContain('Модуль увімкнено.');
      chat.resolve([{ userId: guildId, rank: 1, value: 17 }]);
      await vi.waitFor(() => expect(output.html()).toContain('Ready chat member'));
      expect(output.html()).not.toContain('Ще ніхто не грав');
      expect(output.html()).not.toContain('Модуль увімкнено.');

      slowRankings.resolve([]);
      games.resolve([]);
      await output.finished;
      expect(output.html()).toContain('Серії не залежать від вибраного періоду.');
      expect(output.html()).toContain('Discord ще не передав жодної відстежуваної активності.');
      expect(output.errors).toEqual([]);
    } finally { output.abort(); }
  });

  it('streams the settings form while tracker health is still pending', async () => {
    const health = deferred<null>();
    mocks.access.mockResolvedValue({ guild: { resourceRevision: 0 }, permissions: new Set(['activity.manage']) });
    mocks.settings.mockResolvedValue(activitySettingsSchema.parse({ enabled: true }));
    mocks.resources.mockResolvedValue({ roles: [], channels: [] });
    mocks.profiles.mockResolvedValue([]);
    mocks.health.mockReturnValue(health.promise);
    const output = renderStream(<main><ActivitySettingsPage params={Promise.resolve({ guildId })} searchParams={Promise.resolve({})} /></main>);
    try {
      await vi.waitFor(() => expect(output.html()).toContain('<form>'));
      expect(output.html()).toContain('Зберегти налаштування');
      expect(output.html()).toContain('Завантаження стану трекерів');
      expect(output.html()).not.toContain('Немає свіжого зв’язку з ботом');
      health.resolve(null);
      await output.finished;
      expect(output.html()).toContain('Немає свіжого зв’язку з ботом');
      expect(output.errors).toEqual([]);
    } finally { output.abort(); }
  });

  it('denies settings and tracker reads when the independently rendered blocks lack access', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    const output = renderStream(<main><ActivitySettingsPage params={Promise.resolve({ guildId })} searchParams={Promise.resolve({})} /></main>);
    try {
      await output.finished;
      expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.view');
      expect(mocks.settings).not.toHaveBeenCalled();
      expect(mocks.health).not.toHaveBeenCalled();
      expect(mocks.resources).not.toHaveBeenCalled();
      expect(output.html()).not.toContain('<form>');
      expect(output.errors.length).toBeGreaterThan(0);
    } finally { output.abort(); }
  });
});
