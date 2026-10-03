import { ActivityModuleContent } from '../../module-content';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ActivityHero } from '@/app/components/activity-artwork';
import { activityArtworks, activityArtworkForKey, activityArtworkNeedsRefresh } from '@/lib/activity-artwork';
import { DataLoading } from '@/app/components/data-loading';
import { InlineAction } from '@/app/components/inline-action';
import { activityGame, activityGamePlayers, activityPeriod, activityProfiles, activitySettings } from '@/lib/activity-data';
import { formatActivityDuration, formatActivityRelativeDay, type ActivityGameSummary, type ActivityPeriod } from '@scrt/shared';
import { activityGameKeySchema } from '@scrt/validation';
import { MemberLink, MetricValues, number, PeriodLinks } from '../../components';
import { requireGuildAccess } from '@/lib/guards';
import { ActivityActionsMenu } from '../../activity-actions-menu';

function gameKeyFromParam(value: string): string {
  // Next.js 16.3 passes encoded segments; preserve an already canonical key verbatim.
  if (activityGameKeySchema.safeParse(value).success) return value;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { notFound(); }
  const result = activityGameKeySchema.safeParse(decoded);
  if (!result.success) notFound();
  return result.data;
}

async function GameContributors({ guildId, gameKey, period }: { guildId: string; gameKey: string; period: ActivityPeriod }) {
  const [players, settings] = await Promise.all([activityGamePlayers(guildId, gameKey, period), activitySettings(guildId)]);
  if (!players.length) return <p className="empty-state">За цей період ще немає статистики.</p>;
  const profiles = await activityProfiles(guildId, players.map((row) => row.userId).join(','));
  const identities = new Map(profiles.map((profile) => [profile.userId, profile]));
  const now = Date.now();
  return <div className="activity-table-scroll"><table className="activity-table activity-contributors-table"><thead><tr><th>#</th><th>Учасник</th><th>Час</th><th>Внесок</th><th>Сесії</th><th>Остання активність</th></tr></thead><tbody>{players.map((player, index) => <tr key={player.userId}><td data-label="#">{index + 1}</td><td data-label="Учасник"><MemberLink guildId={guildId} userId={player.userId} profile={identities.get(player.userId)} period={period} /></td><td data-label="Час">{formatActivityDuration(player.totalSeconds)}</td><td data-label="Внесок"><span>{player.contributionPercent.toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%</span><progress className="activity-contribution" value={player.contributionPercent} max={100} aria-label="Частка часу активності" /></td><td data-label="Сесії">{number(player.sessionCount)}</td><td data-label="Остання активність">{formatActivityRelativeDay(player.lastPlayedAt, settings.streak.timezone, now)}</td></tr>)}</tbody></table><p className="field-help">Топ 25 учасників. Внесок розраховано від повного часу активності за вибраний період.</p></div>;
}
async function GameSummary({ guildId, game }: { guildId: string; game: ActivityGameSummary }) {
  const settings = await activitySettings(guildId);
  return <MetricValues compact values={[[ 'Загальний час', formatActivityDuration(game.totalSeconds)], ['Учасники', number(game.uniquePlayers)], ['Сесії', number(game.sessionCount)], ['Остання активність', formatActivityRelativeDay(game.lastPlayedAt, settings.streak.timezone, Date.now())]]} />;
}
async function GameContent({ guildId, gameKey, period }: { guildId: string; gameKey: string; period: ActivityPeriod }) {
  const [game, cachedArtwork, contributors, access] = await Promise.all([activityGame(guildId, gameKey, period), activityArtworkForKey(guildId, gameKey), GameContributors({ guildId, gameKey, period }), requireGuildAccess(guildId, 'activity.view')]);
  if (!game) notFound();
  if (activityArtworkNeedsRefresh(cachedArtwork)) await activityArtworks(guildId, [game]);
  const settings = await activitySettings(guildId);
  const path = '/servers/' + guildId + '/activity/games/' + encodeURIComponent(gameKey);
  return <><ActivityHero gameKey={gameKey} name={game.displayName} artwork={cachedArtwork} actions={<ActivityActionsMenu guildId={guildId} identity={game} artwork={cachedArtwork} href={path + '?period=' + period} canManage={access.permissions.has('activity.manage')} ignored={settings.games.ignoredGameKeys.includes(gameKey)} detail />} /><PeriodLinks path={path} period={period} /><GameSummary guildId={guildId} game={game} /><section className="detail-panel activity-contributors" id="contributors"><h3>Внесок учасників</h3>{contributors}</section></>;
}
export default async function GamePage({ params, searchParams }: { params: Promise<{ guildId: string; gameKey: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId, gameKey: segment } = await params;
  const gameKey = gameKeyFromParam(segment);
  const period = activityPeriod((await searchParams).period);
  return <ActivityModuleContent guildId={guildId}><section className="activity-game-detail"><InlineAction className="activity-more" direction="back" href={'/servers/' + guildId + '/activity/games?period=' + period}>Ігри та застосунки</InlineAction><Suspense key={gameKey + ':' + period} fallback={<DataLoading label="Завантаження статистики…" />}><GameContent guildId={guildId} gameKey={gameKey} period={period} /></Suspense></section></ActivityModuleContent>;
}
