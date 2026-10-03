import { Suspense, type ReactNode } from 'react';
import { ActivityTabs } from '@/app/components/activity-tabs';
import { ActivityStatus } from './module-content';

export default async function ActivityLayout({ params, children }: { params: Promise<{ guildId: string }>; children: ReactNode }) {
  const { guildId } = await params;
  return <main className="content-page content-wide activity-content"><div className="page-heading"><h1>Активність</h1><p>Повідомлення, Voice, демонстрація екрана, ігри та застосунки.</p><Suspense fallback={null}><ActivityStatus guildId={guildId} /></Suspense></div><ActivityTabs guildId={guildId} />{children}</main>;
}
