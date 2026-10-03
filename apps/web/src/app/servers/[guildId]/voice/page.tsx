import Link from 'next/link';
import { Suspense } from 'react';
import { DataLoading } from '@/app/components/data-loading';
import { InlineAction } from '@/app/components/inline-action';
import { requireGuildAccess } from '@/lib/guards';
import { voiceRecords } from '@/lib/voice-data';
import { ModuleDisabledState } from '@/app/components/module-status';
import { ActionForm } from '@/app/components/action-form';
import { Button } from '@/app/components/controls';
import { enableVoice } from './actions';

async function VoiceSummary({ guildId }: { guildId: string }) {
  const access = await requireGuildAccess(guildId, 'voice.view');
  const data = await voiceRecords(guildId);
  if (!data.settings.enabled) return <ModuleDisabledState title="Голосові канали вимкнено" description="SCRT не створює нові голосові кімнати. Наявні кімнати залишаються доступними для керування та автоматичного видалення.">{access.permissions.has('voice.manage') && <ActionForm action={enableVoice.bind(null, guildId)} trackChanges={false}><Button type="submit">Увімкнути голосові канали</Button></ActionForm>}<InlineAction href={`/servers/${guildId}/voice/settings#module-enabled`}>Налаштування модуля</InlineAction><InlineAction href={`/servers/${guildId}/voice/rooms`}>Активні кімнати</InlineAction></ModuleDisabledState>;
  return <dl className="voice-summary voice-module-summary"><div><dt>Канали створення</dt><dd>{data.creators.length}</dd></div><div><dt>Активні кімнати</dt><dd>{data.rooms.length}</dd></div></dl>;
}

export default async function VoiceOverview({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  return <section><h2 className="subheading">Огляд</h2><Suspense fallback={<DataLoading label="Завантаження стану голосового модуля…" />}><VoiceSummary guildId={guildId} /></Suspense>
    <p className="muted">Права бота — у вкладці <Link href={`/servers/${guildId}/voice/permissions`}>Дозволи</Link>.</p>
    <p className="muted">Коли модуль увімкнено, учасник заходить у канал створення, SCRT створює кімнату та переносить його. Порожню кімнату буде видалено після заданої затримки.</p>
  </section>;
}
