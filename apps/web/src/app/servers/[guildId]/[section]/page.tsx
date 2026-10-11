import { notFound } from 'next/navigation';
import { requireGuildAccess } from '@/lib/guards';
import type { AppPermission } from '@scrt/permissions';
import { DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';

const sections: Record<string, { title: string; permission: AppPermission }> = { members: { title: 'Учасники', permission: 'members.view' }, activity: { title: 'Активність', permission: 'activity.view' }, voice: { title: 'Голосові канали', permission: 'voice.view' }, moderation: { title: 'Модерація', permission: 'moderation.view' }, automation: { title: 'Автоматизація', permission: 'automation.view' }, logs: { title: 'Журнал', permission: 'logs.view' }, settings: { title: 'Налаштування', permission: 'settings.view' } };
export default async function Section({ params }: { params: Promise<{ guildId: string; section: string }> }) {
  const { guildId, section } = await params;
  if (!Object.hasOwn(sections, section)) notFound();
  const config = sections[section]!;
  await requireGuildAccess(guildId, config.permission);
  return <DashboardScreen header={<ScreenHeader title={config.title} description="Цей розділ ще недоступний." />} />;
}
