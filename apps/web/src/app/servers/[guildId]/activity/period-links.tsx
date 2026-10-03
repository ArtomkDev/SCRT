import { activityMetrics, activityPeriods, type ActivityMetric, type ActivityPeriod } from '@scrt/shared';
import { PrefetchLink } from '@/app/components/prefetch-link';

export function PeriodLinks({ path, period, metric }: { path?: string; period?: ActivityPeriod; metric?: ActivityMetric }) {
  return <nav className="voice-tabs activity-periods" aria-label="Період">{activityPeriods.map(([value, label]) => path
    ? <PrefetchLink key={value} href={path + '?period=' + value + (metric ? '&metric=' + metric : '')} aria-current={period === value ? 'page' : undefined}>{label}</PrefetchLink>
    : <span key={value} className="loading-tab">{label}</span>)}</nav>;
}

export function MetricLinks({ path, period, metric }: { path?: string; period: ActivityPeriod; metric?: ActivityMetric }) {
  return <nav className="voice-tabs activity-periods" aria-label="Показник">{Object.entries(activityMetrics).map(([key, value]) => path
    ? <PrefetchLink key={key} href={path + '?metric=' + key + '&period=' + period} aria-current={metric === key ? 'page' : undefined}>{value.label}</PrefetchLink>
    : <span key={key} className="loading-tab">{value.label}</span>)}</nav>;
}
