import { ActivityModuleContent } from '../module-content';
import { activityPeriod } from '@/lib/activity-data';
import { ActivitySummary, PeriodLinks, Ranking } from '../components';

export default async function MessagesPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const period = activityPeriod((await searchParams).period);
  return <ActivityModuleContent guildId={guildId}><section><div className="section-intro"><div><h2>Повідомлення</h2><p>Кожне початкове повідомлення враховується один раз. Редагування та видалення не змінюють лічильник.</p></div></div><PeriodLinks path={'/servers/' + guildId + '/activity/messages'} period={period} /><ActivitySummary guildId={guildId} period={period} domain="messages" /><Ranking guildId={guildId} metric="messages" period={period} title="Топ повідомлень" /></section></ActivityModuleContent>;
}
