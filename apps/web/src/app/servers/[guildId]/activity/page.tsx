import { ActivityModuleContent } from './module-content';
import { ActivityPageLoading } from './loading-content';
import { Suspense } from 'react';
import { InlineAction } from '@/app/components/inline-action';
import { activityPeriod } from '@/lib/activity-data';
import { ActivitySummary, GameList, PeriodLinks, Ranking, StreakNote, VoiceRunNote } from './components';

export default async function ActivityOverviewPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const period = activityPeriod((await searchParams).period);
  const root = '/servers/' + guildId + '/activity';
  return <ActivityModuleContent guildId={guildId} fallback={<ActivityPageLoading view="overview" guildId={guildId} period={period} />}>
    <section>
      <div className="section-intro"><div><h2>Огляд</h2><p>Що відбувається на сервері за вибраний період. Активні учасники — автори повідомлень, учасники Voice або демонстрації екрана.</p></div></div>
      <PeriodLinks path={root} period={period} />
      <ActivitySummary guildId={guildId} period={period} />
      <div className="voice-columns">
        <Ranking guildId={guildId} metric="messages" period={period} title="Найактивніші в чаті" limit={3} more />
        <Ranking guildId={guildId} metric="voiceSeconds" period={period} title="Найактивніші у Voice" limit={3} more />
      </div>
      <section className="detail-panel">
        <h3>Найпопулярніші ігри та застосунки</h3>
        <GameList guildId={guildId} period={period} limit={3} />
        <InlineAction className="activity-more" href={root + '/games?period=' + period}>Усі ігри та застосунки</InlineAction>
      </section>
      <div className="voice-columns">
        <div>
          <Ranking guildId={guildId} metric="currentVoiceStreak" period="all" title="Поточні Voice-серії" limit={3} more />
          <Suspense fallback={null}><StreakNote guildId={guildId} /></Suspense>
        </div>
        <div>
          <Ranking guildId={guildId} metric="longestVoiceRunSeconds" period="all" title="Топ безперервного Voice" limit={3} more />
          <Suspense fallback={null}><VoiceRunNote guildId={guildId} /></Suspense>
        </div>
      </div>
    </section>
  </ActivityModuleContent>;
}
