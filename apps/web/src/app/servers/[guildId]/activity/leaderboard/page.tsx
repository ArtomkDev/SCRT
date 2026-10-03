import { ActivityModuleContent } from '../module-content';
import { Suspense } from 'react';
import { activityPeriod } from '@/lib/activity-data';
import { activityMetricSchema } from '@scrt/validation';
import { activityMetrics } from '@scrt/shared';
import { PrefetchLink } from '@/app/components/prefetch-link';
import { PeriodLinks, Ranking, StreakNote } from '../components';

export default async function LeaderboardPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const query = await searchParams;
  const period = activityPeriod(query.period);
  const parsed = activityMetricSchema.safeParse(query.metric ?? 'messages');
  const metric = parsed.success ? parsed.data : 'messages';
  const path = '/servers/' + guildId + '/activity/leaderboard';
  return <ActivityModuleContent guildId={guildId}><section><div className="section-intro"><div><h2>Рейтинг</h2><p>Порівняйте учасників за вибраним показником.</p></div></div><nav className="voice-tabs activity-periods" aria-label="Показник">{Object.entries(activityMetrics).map(([key, value]) => <PrefetchLink key={key} href={path + '?metric=' + key + '&period=' + period} aria-current={metric === key ? 'page' : undefined}>{value.label}</PrefetchLink>)}</nav>{activityMetrics[metric].periodAware ? <PeriodLinks path={path} period={period} metric={metric} /> : <Suspense fallback={null}><StreakNote guildId={guildId} /></Suspense>}<Ranking guildId={guildId} metric={metric} period={activityMetrics[metric].periodAware ? period : 'all'} title={activityMetrics[metric].label} /></section></ActivityModuleContent>;
}
