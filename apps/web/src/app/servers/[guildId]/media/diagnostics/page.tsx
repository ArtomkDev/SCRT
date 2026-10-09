import { requireGuildAccess } from '@/lib/guards';
import { initialMediaSnapshot } from '@/lib/media-data';
import { voicePermissionResources } from '@/lib/voice-data';
import { effectiveBotPermissions, requiredMediaBotPermissions } from '@scrt/discord';
export default async function MediaDiagnosticsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params; const access = await requireGuildAccess(guildId, 'media.view'); const [initial, resources] = await Promise.all([initialMediaSnapshot(guildId, access.user.id), voicePermissionResources(guildId, access.guild.resourceRevision)]);
  const { snapshot, unavailable } = initial; const channelId = snapshot.session?.voiceChannelId ?? snapshot.actorVoice.id; const channel = resources.channels.find((item) => item.id === channelId);
  const effective = channel ? effectiveBotPermissions(guildId, resources.botRoleIds, resources.roles, channel, resources.botId) : null;
  const checks = [['Media worker / внутрішній API', !unavailable], ['Аудіодвигун', snapshot.engine.available], ['FFmpeg', snapshot.engine.ffmpeg], ['Opus', snapshot.engine.opus], ['DAVE', snapshot.engine.dave]] as const;
  return <section className="settings-card"><h2>Діагностика</h2>{unavailable && <p className="form-feedback">{unavailable}</p>}<dl className="media-diagnostics">{checks.map(([label, ok]) => <div key={label}><dt>{label}</dt><dd>{ok ? 'Доступно' : 'Недоступно'}</dd></div>)}<div><dt>Discord Voice</dt><dd>{snapshot.session?.state === 'playing' || snapshot.session?.state === 'paused' ? snapshot.session.voiceChannelName : 'Немає активного з’єднання'}</dd></div></dl><h3>Ефективні дозволи {channel?.name ?? ''}</h3>{effective === null ? <p>Приєднайтеся до Voice для перевірки дозволів каналу.</p> : <ul>{requiredMediaBotPermissions.map(([name, flag]) => <li key={name}>{name}: {(effective & flag) === flag ? 'Надано' : 'Відсутній дозвіл'}</li>)}</ul>}<p className="field-help">Якщо перевірка не пройшла, перевірте права каналу, FFmpeg і змінні MEDIA_BOT_URL / MEDIA_INTERNAL_SECRET. Аудіо відтворює лише bot worker.</p></section>;
}
