import { ActivityModuleContent } from '../module-content';
import { ActivityPageLoading, StreakNoteLoading, VoiceRunNoteLoading } from '../loading-content';
import { Suspense } from 'react';
import { activityPeriod } from '@/lib/activity-data';
import { activityMetricSchema } from '@scrt/validation';
import { activityMetrics } from '@scrt/shared';
import { MetricLinks } from '../period-links';
import { PeriodLinks, Ranking, StreakNote, VoiceRunNote } from '../components';

export default async function LeaderboardPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const query = await searchParams;
  const period = activityPeriod(query.period);
  const parsed = activityMetricSchema.safeParse(query.metric ?? 'messages');
  const metric = parsed.success ? parsed.data : 'messages';
  const path = '/servers/' + guildId + '/activity/leaderboard';
  return <ActivityModuleContent guildId={guildId} fallback={<ActivityPageLoading view="leaderboard" guildId={guildId} period={period} metric={metric} />}><section><div className="section-intro"><div><h2>Рейтинг</h2><p>Порівняйте учасників за вибраним показником.</p></div></div><MetricLinks path={path} period={period} metric={metric} />{activityMetrics[metric].periodAware ? <PeriodLinks path={path} period={period} metric={metric} /> : <Suspense fallback={metric === 'longestVoiceRunSeconds' ? <VoiceRunNoteLoading /> : <StreakNoteLoading />}>{metric === 'longestVoiceRunSeconds' ? <VoiceRunNote guildId={guildId} /> : <StreakNote guildId={guildId} />}</Suspense>}<Ranking guildId={guildId} metric={metric} period={activityMetrics[metric].periodAware ? period : 'all'} title={activityMetrics[metric].label} /></section></ActivityModuleContent>;
}
