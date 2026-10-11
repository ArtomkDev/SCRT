import { Suspense, type ReactNode } from 'react';
import { ActivityTabs } from '@/app/components/activity-tabs';
import { ActivityStatus } from './module-content';
import { DataBoundary } from '@/app/components/data-boundary';
import { DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';
import { GuildModuleStatus } from '@/app/components/guild-module-status';

export default async function ActivityLayout({ params, children }: { params: Promise<{ guildId: string }>; children: ReactNode }) {
  const { guildId } = await params;
  const fallback = <GuildModuleStatus guildId={guildId} module="activity" />;
  return <DashboardScreen width="wide" className="activity-content" header={<ScreenHeader title="Активність" description="Повідомлення, Voice, демонстрація екрана, ігри та застосунки." navigation={<ActivityTabs guildId={guildId} />} status={<DataBoundary title="Статус активності недоступний" compact fallback={fallback}><Suspense fallback={fallback}><ActivityStatus guildId={guildId} /></Suspense></DataBoundary>} />}>{children}</DashboardScreen>;
}
