import { installUrl } from '@scrt/discord';
import { requireGuildAccess } from '@/lib/guards';
import { env } from '@/lib/server';
import { permissionStatus, voiceCreators, voiceInterfaces, voicePermissionResources } from '@/lib/voice-data';

const names = ['Перегляд каналів', 'Керування каналами', 'Керування ролями', 'Переміщення учасників', 'Підключення', 'Надсилання повідомлень', 'Вбудовування посилань', 'Історія повідомлень'];

export default async function VoicePermissionsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'voice.view');
  const [creators, resources, interfaces] = await Promise.all([voiceCreators(guildId), voicePermissionResources(guildId, access.guild.resourceRevision), voiceInterfaces(guildId)]);
  const groups = [{ label: 'Дозволи ролі бота', channel: undefined }, ...creators.flatMap((creator) => {
    const channel = resources.channels.find((item) => item.id === creator.channelId);
    const categoryId = creator.targetCategoryId ?? channel?.parent_id;
    const category = resources.channels.find((item) => item.id === categoryId);
    return [{ label: `Канал створення: ${channel?.name ?? 'Канал не знайдено'}`, channel }, { label: `Категорія: ${category?.name ?? 'Без категорії'}`, channel: category }];
  }), ...interfaces.map((item) => ({ label: `Панель: ${resources.channels.find((channel) => channel.id === item.channelId)?.name ?? 'Канал не знайдено'}`, channel: resources.channels.find((channel) => channel.id === item.channelId) }))];
  const missing = groups.some((group) => permissionStatus(guildId, resources, group.channel).some((item) => !item.granted));
  return <section><h2 className="subheading">Дозволи SCRT</h2>
    {missing && <div className="voice-warning"><p>Боту бракує прав для роботи з голосовими кімнатами. Відсутні дозволи позначено в таблиці.</p><a className="action-link" href={installUrl(env().DISCORD_CLIENT_ID, guildId)}>Оновити дозволи</a></div>}
    {groups.map((group) => <section key={group.label} className="voice-item"><h3>{group.label}</h3><ul className="voice-permission-list">{permissionStatus(guildId, resources, group.channel).map((item, index) => <li key={item.flag.toString()} className={item.granted ? 'voice-ok' : 'voice-missing'}>{item.granted ? '✓' : '✕'} {names[index]}</li>)}</ul></section>)}
    <p className="muted">Права окремого каналу можуть перевизначати права ролі бота. Для роботи з категоріями перевірте також права бота на сервері.</p>
  </section>;
}
