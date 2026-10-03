import { ActivityModuleContent } from '../module-content';
import { ActivityPageLoading } from '../loading-content';
import { activityPeriod } from '@/lib/activity-data';
import { GameList, PeriodLinks } from '../components';

export default async function GamesPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const period = activityPeriod((await searchParams).period);
  return <ActivityModuleContent guildId={guildId} fallback={<ActivityPageLoading view="games" guildId={guildId} period={period} />}><section className="activity-games-page"><div className="section-intro"><div><h2>Ігри та застосунки</h2><p>Час, учасники та сесії відстежуваних активностей.</p></div></div><PeriodLinks path={'/servers/' + guildId + '/activity/games'} period={period} /><GameList guildId={guildId} period={period} /></section></ActivityModuleContent>;
}
