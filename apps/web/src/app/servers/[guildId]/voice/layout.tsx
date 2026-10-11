import { Suspense, type ReactNode } from 'react';
import { VoiceTabs } from '../../../components/voice-tabs';
import { requireGuildAccess } from '@/lib/guards';
import { voiceSettings } from '@/lib/voice-data';
import { GuildModuleStatus } from '@/app/components/guild-module-status';
import { DataBoundary } from '@/app/components/data-boundary';
import { DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';

async function VoiceStatus({ guildId }: { guildId: string }) {
  await requireGuildAccess(guildId, 'voice.view');
  const settings = await voiceSettings(guildId);
  return <GuildModuleStatus guildId={guildId} module="voice" state={settings.enabled ? 'enabled' : 'disabled'} />;
}

export default async function VoiceLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const fallback = <GuildModuleStatus guildId={guildId} module="voice" />;
  return <DashboardScreen header={<ScreenHeader title="Голосові канали" description="Створення та налаштування тимчасових голосових кімнат." navigation={<VoiceTabs guildId={guildId} />} status={<DataBoundary title="Статус голосових каналів недоступний" compact fallback={fallback}><Suspense fallback={fallback}><VoiceStatus guildId={guildId} /></Suspense></DataBoundary>} />}>{children}</DashboardScreen>;
}
