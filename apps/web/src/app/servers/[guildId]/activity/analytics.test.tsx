import { Writable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activityGameKeySchema, activitySettingsSchema } from '@scrt/validation';
vi.stubGlobal('React', React);
vi.mock('@/lib/activity-artwork', () => ({ activityArtworks: async () => [], activityArtworkForKey: async () => null, activityArtworkHealth: async () => [], activityArtworkNeedsRefresh: () => true }));
vi.mock('./artwork-actions', () => ({ editActivityArtwork: vi.fn(), refreshActivityArtwork: vi.fn(), resetActivityArtwork: vi.fn(), enrichMissingArtworkBatch: vi.fn() }));
vi.mock('./artwork-picker', () => ({ ArtworkPicker: () => null }));
const mocks = vi.hoisted(() => ({
  overview: vi.fn(), voice: vi.fn(), messages: vi.fn(), ranking: vi.fn(), games: vi.fn(),
  profiles: vi.fn(), game: vi.fn(), players: vi.fn(), observed: vi.fn(), settings: vi.fn(),
  member: vi.fn(), memberGames: vi.fn(), identity: vi.fn(), directory: vi.fn(), health: vi.fn(),
  path: '/servers/12345678901234567/activity',
}));
vi.mock('@/lib/activity-data', () => ({
  activityOverview: mocks.overview, activityVoiceSummary: mocks.voice, activityMessageSummary: mocks.messages,
  activityRanking: mocks.ranking, activityGames: mocks.games, activityProfiles: mocks.profiles,
  activityGame: mocks.game, activityGamePlayers: mocks.players, activityObservedGames: mocks.observed,
  activitySettings: mocks.settings, activityMember: mocks.member, activityMemberGames: mocks.memberGames,
  activityMemberIdentity: mocks.identity, activityDirectory: mocks.directory, activityHealth: mocks.health,
  activityPeriod: (value: unknown) => ['today', '7d', '30d', 'all'].includes(String(value)) && typeof value === 'string' ? value : 'all',
}));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: async () => ({ guild: { resourceRevision: 0 }, permissions: new Set(['activity.view', 'activity.manage']) }) }));
vi.mock('@/lib/voice-data', () => ({ voiceResources: async () => ({ roles: [], channels: [] }) }));
vi.mock('./actions', () => ({ saveActivitySettings: vi.fn(), setActivityGameIgnored: vi.fn(), enableActivity: vi.fn() }));
vi.mock('@/app/components/action-form', () => ({ ActionForm: ({ children, className }: { children: React.ReactNode; className?: string }) => <form className={className}>{children}</form> }));
vi.mock('./settings/user-exclusions', () => ({ UserExclusions: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => mocks.path, notFound: () => { throw new Error('Not found'); } }));
vi.mock('next/image', () => ({ default: (props: React.ComponentProps<'img'> & { unoptimized?: boolean }) => { const imageProps = { ...props }; delete imageProps.unoptimized; return <img {...imageProps} />; } }));
vi.mock('@/app/components/prefetch-link', () => ({ PrefetchLink: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));

import OverviewPage from './page';
import VoicePage from './voice/page';
import MessagesPage from './messages/page';
import RankingPage from './leaderboard/page';
import GamesPage from './games/page';
import GamePage from './games/[gameKey]/page';
import MembersPage from './members/page';
import MemberPage from './members/[userId]/page';
import SettingsPage from './settings/page';
import ActivityLayout from './layout';
import { ActivityTabs } from '@/app/components/activity-tabs';

const guildId = '12345678901234567'; const userId = '22345678901234567';
const params = Promise.resolve({ guildId });
const game = { gameKey: 'name:dota 2', displayName: 'Dota 2', applicationId: null, totalSeconds: 19200, uniquePlayers: 2, sessionCount: 12, lastPlayedAt: Date.now(), activityPercent: 100 };
const profile = { userId, displayName: 'ARTOMK', username: 'artomk', avatarUrl: '', updatedAt: 0, searchName: 'artomk' };
async function html(tree: React.ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = '';
    const sink = new Writable({ write(chunk: Buffer, _encoding, done) { result += chunk.toString(); done(); } });
    sink.on('finish', () => resolve(result.replace(/<!--[\s\S]*?-->/g, '')));
    const stream = renderToPipeableStream(tree, { onAllReady() { stream.pipe(sink); }, onError: reject });
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue(activitySettingsSchema.parse({ enabled: true, streak: { minimumVoiceSecondsPerDay: 600 } }));
  mocks.overview.mockResolvedValue({ messages: 4821, voiceSeconds: 185040, streamSeconds: 2400, activeMembers: 3 });
  mocks.messages.mockResolvedValue({ messages: 4821, authors: 3, average: 1607 });
  mocks.voice.mockResolvedValue({ voiceSeconds: 185040, streamSeconds: 2400, participants: 3 });
  mocks.ranking.mockImplementation(async (_guild, metric, _period, limit) => [
    { userId, rank: 1, value: metric === 'messages' ? 4821 : metric.endsWith('Streak') ? 23 : 185040 },
    { userId: '32345678901234567', rank: 2, value: metric === 'messages' ? 3170 : metric.endsWith('Streak') ? 8 : 151860 },
  ].slice(0, limit));
  mocks.games.mockResolvedValue([game]);
  mocks.profiles.mockResolvedValue([profile]);
  mocks.game.mockResolvedValue(game);
  mocks.players.mockResolvedValue([{ userId, totalSeconds: 10240, contributionPercent: 53.333333, sessionCount: 7, lastPlayedAt: Date.now() }, { userId: '32345678901234567', totalSeconds: 8960, contributionPercent: 46.666667, sessionCount: 5, lastPlayedAt: Date.now() }]);
  mocks.observed.mockResolvedValue({ games: [game, { ...game, gameKey: 'name:visual studio code', displayName: 'Visual Studio Code' }], next: null });
  mocks.member.mockResolvedValue({ messages: 4821, voiceSeconds: 185040, streamSeconds: 2400, currentVoiceStreak: 23, longestVoiceStreak: 28, lastActivityAt: Date.now() });
  mocks.memberGames.mockResolvedValue([game]);
  mocks.identity.mockResolvedValue({ member: { username: profile.username, globalName: profile.displayName, avatarUrl: null }, left: false });
  mocks.directory.mockResolvedValue({ profiles: [profile], next: null });
  mocks.health.mockResolvedValue(null);
});

describe('Activity page domain and navigation semantics', () => {
  it.each([OverviewPage, VoicePage, MessagesPage, RankingPage, GamesPage, MembersPage])('gates disabled module analytics before domain queries', async (Page) => {
    mocks.settings.mockResolvedValue(activitySettingsSchema.parse({ enabled: false }));
    const output = await html(await Page({ params, searchParams: Promise.resolve({}) }));
    expect(output).toContain('Активність вимкнено');
    expect(output).toContain('Історичні дані збережено');
    expect(output).toContain('Увімкнути активність');
    expect(output).toContain(`/servers/${guildId}/activity/settings`);
    expect(mocks.overview).not.toHaveBeenCalled(); expect(mocks.voice).not.toHaveBeenCalled();
    expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.ranking).not.toHaveBeenCalled();
    expect(mocks.games).not.toHaveBeenCalled(); expect(mocks.directory).not.toHaveBeenCalled();
  });
  it('Voice renders only Voice metrics and queries no overview/message totals', async () => {
    const output = await html(await VoicePage({ params, searchParams: Promise.resolve({ period: '7d' }) }));
    expect(output).not.toContain('Повідомлення');
    expect(mocks.overview).not.toHaveBeenCalled(); expect(mocks.messages).not.toHaveBeenCalled();
    expect(mocks.voice).toHaveBeenCalledWith(guildId, '7d');
    expect(mocks.ranking).toHaveBeenCalledWith(guildId, 'currentVoiceStreak', 'all', 25);
    expect(output).toContain('після 10 хв у Voice');
    expect(output.match(/aria-label="Період"/g)).toHaveLength(1);
  });
  it('Messages renders selected-period counters and queries no Voice metrics', async () => {
    const output = await html(await MessagesPage({ params, searchParams: Promise.resolve({ period: '30d' }) }));
    expect(mocks.messages).toHaveBeenCalledWith(guildId, '30d');
    expect(mocks.voice).not.toHaveBeenCalled(); expect(mocks.overview).not.toHaveBeenCalled();
    expect(output).not.toContain('Voice'); expect(output).not.toContain('Демонстрація екрана');
    expect(output.match(/aria-label="Період"/g)).toHaveLength(1);
    expect(output).toContain('Активні автори');
  });
  it.each(['currentVoiceStreak', 'longestVoiceStreak'])('hides period control and requests all-time %s', async (metric) => {
    const output = await html(await RankingPage({ params, searchParams: Promise.resolve({ metric, period: '7d' }) }));
    expect(output).not.toContain('aria-label="Період"');
    expect(mocks.ranking).toHaveBeenCalledWith(guildId, metric, 'all', 25);
  });
  it('shows compact overview leaders and preserves period in game/member navigation', async () => {
    const output = await html(await OverviewPage({ params, searchParams: Promise.resolve({ period: '7d' }) }));
    expect(mocks.games).toHaveBeenCalledWith(guildId, '7d', 3);
    expect(mocks.ranking).toHaveBeenCalledWith(guildId, 'messages', '7d', 3);
    expect(output).toContain('/games/name%3Adota%202?period=7d');
    expect(output).toContain('/members/' + userId + '?period=7d');
    expect(output).toContain('Дії: Dota 2');
    expect(output).not.toContain('Змінити іконку');
    expect(output).not.toContain('Змінити банер');
  });
  it('renders server-calculated contribution, sessions, dates and member identity fallback', async () => {
    const output = await html(await GamePage({ params: Promise.resolve({ guildId, gameKey: game.gameKey }), searchParams: Promise.resolve({ period: '7d' }) }));
    expect(mocks.game).toHaveBeenCalledWith(guildId, game.gameKey, '7d');
    expect(mocks.players).toHaveBeenCalledWith(guildId, game.gameKey, '7d');
    expect(output).toContain('53,3%'); expect(output).toContain('Внесок учасників');
    expect(output).toContain('Учасник 32345678901234567');
    expect(output).toContain('/members/' + userId + '?period=7d');
    expect(output).toContain('/games?period=7d');
    expect(mocks.profiles).toHaveBeenCalledTimes(1);
  });
  it.each([
    'app:356875988589740042',
    'app:1498738880260866179',
    'name:visual studio code',
    'name:100% achievement / українська',
    'name:literal%3Avalue',
  ])('opens the players link with encoded Next.js params for %s', async (gameKey) => {
    const selectedGame = { ...game, gameKey };
    mocks.games.mockResolvedValue([selectedGame]);
    mocks.game.mockImplementation(async (_guild, key) => {
      activityGameKeySchema.parse(key);
      return selectedGame;
    });
    mocks.players.mockImplementation(async (_guild, key) => {
      activityGameKeySchema.parse(key);
      return [];
    });
    const segment = encodeURIComponent(gameKey);
    const href = '/servers/' + guildId + '/activity/games/' + segment + '?period=today';
    const listing = await html(await GamesPage({ params, searchParams: Promise.resolve({ period: 'today' }) }));
    expect(listing).toContain('href="' + href + '"');
    const output = await html(await GamePage({ params: Promise.resolve({ guildId, gameKey: segment }), searchParams: Promise.resolve({ period: 'today' }) }));
    expect(mocks.game).toHaveBeenCalledWith(guildId, gameKey, 'today');
    expect(mocks.players).toHaveBeenCalledWith(guildId, gameKey, 'today');
    expect(output).toContain(href);
    expect(output).not.toContain('/games/' + encodeURIComponent(segment));
  });
  it.each(['bad-key', 'name%3A', 'app%3A123', '%E0%A4%A', 'name%253Avisual%2520studio%2520code'])('returns not found for malformed game param %s before data reads', async (gameKey) => {
    await expect(GamePage({ params: Promise.resolve({ guildId, gameKey }), searchParams: Promise.resolve({}) })).rejects.toThrow('Not found');
    expect(mocks.game).not.toHaveBeenCalled();
    expect(mocks.players).not.toHaveBeenCalled();
  });
  it('keeps exactly one selected tab on nested game and member pages', async () => {
    for (const suffix of ['/games/name%3Adota%202', '/members/' + userId]) {
      mocks.path = '/servers/' + guildId + '/activity' + suffix;
      const output = await html(<ActivityTabs guildId={guildId} />);
      expect(output.match(/aria-current="page"/g)).toHaveLength(1);
      expect(output).toContain('Ігри та застосунки');
    }
  });
  it('offers restore controls for ignored observed applications without a period control', async () => {
    mocks.settings.mockResolvedValue(activitySettingsSchema.parse({ enabled: true, games: { ignoredGameKeys: ['name:visual studio code'] } }));
    const output = await html(<SettingsPage params={params} searchParams={Promise.resolve({})} />);
    expect(output).toContain('Ігнорується'); expect(output).toContain('Відстежувати');
    expect(output).toContain('value="name:visual studio code"');
    expect(output).not.toContain('aria-label="Період"');
  });
  it('renders all analytical destinations for visual verification with synthetic data', async () => {
    const directory = process.env.SCRT_ACTIVITY_PREVIEW_DIR;
    const query = Promise.resolve({ period: '7d' });
    const pages = [
      ['overview', '', await OverviewPage({ params, searchParams: query })],
      ['voice', '/voice', await VoicePage({ params, searchParams: query })],
      ['messages', '/messages', await MessagesPage({ params, searchParams: query })],
      ['ranking', '/leaderboard', await RankingPage({ params, searchParams: query })],
      ['games', '/games', await GamesPage({ params, searchParams: query })],
      ['game', '/games/name%3Adota%202', await GamePage({ params: Promise.resolve({ guildId, gameKey: game.gameKey }), searchParams: query })],
      ['members', '/members', await MembersPage({ params, searchParams: Promise.resolve({}) })],
      ['member', '/members/' + userId, await MemberPage({ params: Promise.resolve({ guildId, userId }), searchParams: query })],
      ['settings', '/settings', <SettingsPage params={params} searchParams={Promise.resolve({})} />],
    ] as const;
    if (directory) await mkdir(directory, { recursive: true });
    for (const [name, suffix, page] of pages) {
      mocks.path = '/servers/' + guildId + '/activity' + suffix;
      const output = await html(await ActivityLayout({ params, children: page }));
      expect(output).toContain('<h1>Активність</h1>');
      if (directory) await writeFile(join(directory, name + '.html'), output);
    }
  });
});
