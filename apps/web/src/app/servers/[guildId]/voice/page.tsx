import Link from 'next/link';
import { requireGuildAccess } from '@/lib/guards';
import { voiceRecords } from '@/lib/voice-data';

export default async function VoiceOverview({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireGuildAccess(guildId, 'voice.view');
  const data = await voiceRecords(guildId);
  return <section><h2 className="subheading">Огляд</h2><dl className="voice-summary"><div className={!data.settings.enabled ? 'module-disabled' : undefined}><dt>Модуль</dt><dd>{data.settings.enabled ? 'Увімкнено' : <Link href={`/servers/${guildId}/voice/settings#module-enabled`} className="module-enable-link">Вимкнено <span>Увімкнути в налаштуваннях →</span></Link>}</dd></div><div><dt>Канали створення</dt><dd>{data.creators.length}</dd></div><div><dt>Активні кімнати</dt><dd>{data.rooms.length}</dd></div></dl>
    <p className="muted">Права бота — у вкладці <Link href={`/servers/${guildId}/voice/permissions`}>Дозволи</Link>.</p>
    <p className="muted">Учасник заходить у канал створення, SCRT створює кімнату та переносить його. Порожню кімнату буде видалено після заданої затримки.</p>
  </section>;
}
