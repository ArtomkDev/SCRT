import { activityMetrics, activityPeriods, type ActivityMetric, type ActivityPeriod } from '@scrt/shared';
import { FilterLinks } from '@/app/components/filter-links';

export function PeriodLinks({ path, period, metric }: { path?: string; period?: ActivityPeriod; metric?: ActivityMetric }) {
  return <FilterLinks label="Період" className="activity-periods" entries={activityPeriods.map(([value, label]) => ({
    id: value, label, current: period === value, href: path ? path + '?period=' + value + (metric ? '&metric=' + metric : '') : undefined,
  }))} />;
}

export function MetricLinks({ path, period, metric }: { path?: string; period: ActivityPeriod; metric?: ActivityMetric }) {
  return <FilterLinks label="Показник" className="activity-periods" entries={Object.entries(activityMetrics).map(([key, value]) => ({
    id: key, label: value.label, current: metric === key, href: path ? path + '?metric=' + key + '&period=' + period : undefined,
  }))} />;
}
