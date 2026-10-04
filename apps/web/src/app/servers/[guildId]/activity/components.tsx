import { InlineAction } from '@/app/components/inline-action';
import Image from 'next/image';
import { Suspense } from 'react';
import { PrefetchLink } from '@/app/components/prefetch-link';
import { MetricsLoading, RowsLoading } from '@/app/components/data-loading';
import { DataBoundary } from '@/app/components/data-boundary';
import { GamesLoading, gamesTimeLabel, summaryLabels } from './loading-content';
import { ActivityIcon } from '@/app/components/activity-artwork';
import { activityArtworks } from '@/lib/activity-artwork';
import { ActivityActionsMenu } from './activity-actions-menu';
import { requireGuildAccess } from '@/lib/guards';
import { activityGames, activityGameTimeTotal, activityMemberGameTimeTotal, activityOverview, activityProfiles, activityRanking, activitySettings, activityMessageSummary, activityVoiceSummary } from '@/lib/activity-data';
import { activityMetrics, formatActivityDuration, formatActivityRelativeDay, type ActivityGameSummary, type ActivityLeaderboardEntry, type ActivityMetric, type ActivityPeriod, type ActivityProfile, type ActivityTotals } from '@scrt/shared';
export { PeriodLinks } from './period-links';

export const number = (value: number) => Math.floor(value).toLocaleString('uk-UA');
export function MetricValues({ values, compact = false }: { values: Array<[string, string]>; compact?: boolean }) {
  return <dl className={`voice-summary activity-summary${compact ? ' activity-game-metrics' : ''}`}>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export function ActivityStats({ data }: { data: ActivityTotals & { activeMembers?: number } }) {
  const values: Array<[string, string]> = [['Повідомлення', number(data.messages)], ['Voice', formatActivityDuration(data.voiceSeconds)], ['Демонстрація екрана', formatActivityDuration(data.streamSeconds)]];
  if (data.activeMembers !== undefined) values.push(['Активні учасники', number(data.activeMembers)]);
  return <MetricValues values={values} />;
}
async function SummaryValues({ guildId, period, domain }: { guildId: string; period: ActivityPeriod; domain: 'overview' | 'voice' | 'messages' }) {
  if (domain === 'voice') {
    const data = await activityVoiceSummary(guildId, period);
    return <MetricValues values={[[activityMetrics.voiceSeconds.label, formatActivityDuration(data.voiceSeconds)], [activityMetrics.streamSeconds.label, formatActivityDuration(data.streamSeconds)], ['Учасники Voice', number(data.participants)]]} />;
  }
  if (domain === 'messages') {
    const data = await activityMessageSummary(guildId, period);
    return <MetricValues values={[[activityMetrics.messages.label, number(data.messages)], ['Активні автори', number(data.authors)], ['Середньо на активного автора', data.average.toLocaleString('uk-UA', { maximumFractionDigits: 1 })]]} />;
  }
  return <ActivityStats data={await activityOverview(guildId, period)} />;
}
export function ActivitySummary({ guildId, period, domain = 'overview' }: { guildId: string; period: ActivityPeriod; domain?: 'overview' | 'voice' | 'messages' }) {
  return <DataBoundary key={period} title="Показники не завантажилися"><Suspense fallback={<MetricsLoading labels={summaryLabels[domain]} />}><SummaryValues guildId={guildId} period={period} domain={domain} /></Suspense></DataBoundary>;
}
export function MemberLink({ guildId, userId, profile, period }: { guildId: string; userId: string; profile?: ActivityProfile; period?: ActivityPeriod }) {
  return <PrefetchLink className="activity-identity" title={profile?.displayName ?? 'Учасник ' + userId} href={'/servers/' + guildId + '/activity/members/' + userId + (period ? '?period=' + period : '')}>{profile?.avatarUrl ? <Image src={profile.avatarUrl} alt="" width={32} height={32} unoptimized /> : <span className="activity-avatar" aria-hidden="true">?</span>}<span>{profile?.displayName ?? 'Учасник ' + userId}{profile?.username && <small>@{profile.username}</small>}</span></PrefetchLink>;
}
export async function MemberRows({ guildId, rows, metric, period }: { guildId: string; rows: ActivityLeaderboardEntry[]; metric: ActivityMetric; period?: ActivityPeriod }) {
  if (!rows.length) return <p className="empty-state">{metric === 'streamSeconds' ? 'За цей період демонстрацій екрана ще не було.' : activityMetrics[metric].periodAware ? 'За цей період ще немає статистики.' : 'Серій ще немає.'}</p>;
  const profiles = await activityProfiles(guildId, rows.map((row) => row.userId).join(','));
  const identities = new Map(profiles.map((profile) => [profile.userId, profile]));
  return <ol className="activity-ranking">{rows.map((row) => <li key={row.userId}><span className="activity-rank">{row.rank}</span><MemberLink guildId={guildId} userId={row.userId} profile={identities.get(row.userId)} period={period} /><strong>{activityMetrics[metric].unit === 'count' ? number(row.value) : activityMetrics[metric].unit === 'days' ? number(row.value) + ' дн.' : formatActivityDuration(row.value)}</strong></li>)}</ol>;
}
async function RankingValues({ guildId, metric, period, limit }: { guildId: string; metric: ActivityMetric; period: ActivityPeriod; limit: number }) {
  return <MemberRows guildId={guildId} metric={metric} period={period} rows={await activityRanking(guildId, metric, activityMetrics[metric].periodAware ? period : 'all', limit)} />;
}
export function Ranking({ guildId, metric, period, title, limit = 25, more = false }: { guildId: string; metric: ActivityMetric; period: ActivityPeriod; title: string; limit?: number; more?: boolean }) {
  return <section className="detail-panel"><h3>{title}</h3><DataBoundary key={`${metric}:${period}`} title="Рейтинг не завантажився"><Suspense fallback={<RowsLoading label="Завантаження рейтингу…" />}><RankingValues guildId={guildId} metric={metric} period={period} limit={limit} /></Suspense></DataBoundary>{more && <InlineAction className="activity-more" href={'/servers/' + guildId + '/activity/leaderboard?metric=' + metric + (activityMetrics[metric].periodAware ? '&period=' + period : '')}>Переглянути рейтинг</InlineAction>}</section>;
}
async function GameListValues({ guildId, period, limit }: { guildId: string; period: ActivityPeriod; limit: number }) {
  return <GamesTable guildId={guildId} period={period} games={await activityGames(guildId, period, limit)} />;
}
export function GameList({ guildId, period, limit = 25 }: { guildId: string; period: ActivityPeriod; limit?: number }) {
  return <DataBoundary key={period} title="Ігри та застосунки не завантажилися"><Suspense fallback={<GamesLoading />}><GameListValues guildId={guildId} period={period} limit={limit} /></Suspense></DataBoundary>;
}
async function GamesTimeValue({ guildId, period, userId }: { guildId: string; period: ActivityPeriod; userId?: string }) {
  const seconds = userId ? await activityMemberGameTimeTotal(guildId, userId, period) : await activityGameTimeTotal(guildId, period);
  return <MetricValues values={[[userId ? 'Загальний час в іграх та застосунках' : gamesTimeLabel, formatActivityDuration(seconds)]]} />;
}
export function GamesTimeSummary({ guildId, period, userId }: { guildId: string; period: ActivityPeriod; userId?: string }) {
  return <div className="activity-games-total"><DataBoundary key={period} title="Час активності не завантажився"><Suspense fallback={<MetricsLoading labels={[userId ? 'Загальний час в іграх та застосунках' : gamesTimeLabel]} />}><GamesTimeValue guildId={guildId} period={period} userId={userId} /></Suspense></DataBoundary></div>;
}
export async function GamesTable({ guildId, games, period, member = false }: { guildId: string; games: ActivityGameSummary[]; period: ActivityPeriod; member?: boolean }) {
  if (!games.length) return <p className="empty-state">За цей період Discord ще не передав жодної відстежуваної активності.</p>;
  const [settings, artwork, access] = await Promise.all([activitySettings(guildId), activityArtworks(guildId, games), requireGuildAccess(guildId, 'activity.view')]);
  const byKey = new Map(artwork.map((item) => [item.gameKey, item]));
  const now = Date.now();
  return <div className="activity-table-scroll activity-games-scroll"><table className="activity-table activity-games-table"><thead><tr><th>Активність</th><th>Час</th><th>{member ? 'Частка активності' : 'Учасники'}</th><th>Сесії</th>{!member && <th>Остання активність</th>}<th><span className="activity-visually-hidden">Дії</span></th></tr></thead><tbody>{games.map((game) => {
    const href = '/servers/' + guildId + '/activity/games/' + encodeURIComponent(game.gameKey) + '?period=' + period;
    const visual = byKey.get(game.gameKey);
    return <tr key={game.gameKey}><td data-label="Активність"><PrefetchLink className="activity-identity" title={game.displayName} href={href}><ActivityIcon gameKey={game.gameKey} name={game.displayName} artwork={visual} /><span>{game.displayName}{visual?.classification === 'game' ? <small>Гра</small> : visual?.classification === 'application' ? <small>Застосунок</small> : null}</span></PrefetchLink></td><td data-label="Час">{formatActivityDuration(game.totalSeconds)}</td><td data-label={member ? 'Частка активності' : 'Учасники'}>{member ? (game.activityPercent ?? 0).toLocaleString('uk-UA', { maximumFractionDigits: 1 }) + '%' : number(game.uniquePlayers)}</td><td data-label="Сесії">{number(game.sessionCount)}</td>{!member && <td data-label="Остання активність">{formatActivityRelativeDay(game.lastPlayedAt, settings.streak.timezone, now)}</td>}<td className="activity-row-actions"><ActivityActionsMenu guildId={guildId} identity={game} artwork={visual} href={href} canManage={access.permissions.has('activity.manage')} ignored={settings.games.ignoredGameKeys.includes(game.gameKey)} /></td></tr>;
  })}</tbody></table></div>;
}
export async function StreakNote({ guildId }: { guildId: string }) {
  const settings = await activitySettings(guildId);
  return <p className="field-help">Серії не залежать від вибраного періоду. День серії зараховується після {formatActivityDuration(settings.streak.minimumVoiceSecondsPerDay)} у Voice.</p>;
}
export async function VoiceRunNote({ guildId }: { guildId: string }) {
  const settings = await activitySettings(guildId);
  return <p className="field-help">Рекорд безперервного Voice за весь час. Перехід між дозволеними каналами цього сервера зберігає серію. {settings.voice.returnGraceSeconds ? <>На повернення після виходу є {formatActivityDuration(settings.voice.returnGraceSeconds)}; час поза Voice не зараховується.</> : 'Вихід одразу завершує серію.'} Виключені канали, ролі та учасники завершують серію. Рекорд зараховується від {formatActivityDuration(settings.voice.minimumSessionSeconds)} у Voice.</p>;
}
