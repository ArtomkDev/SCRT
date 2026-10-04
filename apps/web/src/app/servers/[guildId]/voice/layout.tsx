import { Suspense, type ReactNode } from 'react';
import { VoiceTabs } from '../../../components/voice-tabs';
import { requireGuildAccess } from '@/lib/guards';
import { voiceSettings } from '@/lib/voice-data';
import { ModuleStatus } from '@/app/components/module-status';
import { DataBoundary } from '@/app/components/data-boundary';

async function VoiceStatus({ guildId }: { guildId: string }) {
  await requireGuildAccess(guildId, 'voice.view');
  const settings = await voiceSettings(guildId);
  return <ModuleStatus state={settings.enabled ? 'enabled' : 'disabled'} />;
}

export default async function VoiceLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  return <main className="content-page"><div className="page-heading"><h1>Голосові канали</h1><p>Створення та налаштування тимчасових голосових кімнат.</p><DataBoundary title="Статус голосових каналів недоступний" compact><Suspense fallback={null}><VoiceStatus guildId={guildId} /></Suspense></DataBoundary></div><VoiceTabs guildId={guildId} />{children}</main>;
}
