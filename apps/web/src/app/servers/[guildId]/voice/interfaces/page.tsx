import { requireGuildAccess } from '@/lib/guards';
import { voiceChannels, voiceCreators, voiceInterfaces } from '@/lib/voice-data';
import { deleteVoiceInterface, publishVoiceInterface, setVoiceInterfaceEnabled } from '../actions';
import { ActionForm } from '@/app/components/action-form';

export default async function VoiceInterfacesPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'voice.view');
  const [creators, channels, interfaces] = await Promise.all([voiceCreators(guildId), voiceChannels(guildId, access.guild.resourceRevision), voiceInterfaces(guildId)]);
  const editable = access.permissions.has('voice.manage');
  return <section><h2 className="subheading">Панелі керування</h2><p className="muted">Опублікуйте кнопки керування кімнатами в текстовому каналі. Власник кімнати також може відкрити панель командою /voice panel.</p>
    {interfaces.length === 0 && <p className="empty-state">Немає опублікованих панелей.</p>}
    {interfaces.map((item) => <div key={item.id} className="voice-item"><h3>{channels.find((channel) => channel.id === item.channelId)?.name ?? 'Канал не знайдено'}</h3><p>Повідомлення: {item.messageId ?? 'Відсутнє'} · {item.enabled ? 'Увімкнено' : 'Вимкнено'}</p><p>Канали створення: {item.creatorIds?.map((id) => creators.find((creator) => creator.id === id)?.channelId ?? id).join(', ') ?? 'Усі'}</p>
      {editable && <div className="voice-actions"><ActionForm action={publishVoiceInterface.bind(null, guildId)}><input type="hidden" name="channelId" value={item.channelId} />{item.creatorIds?.map((id) => <input key={id} type="hidden" name="creatorIds" value={id} />)}<button type="submit">Опублікувати повторно</button></ActionForm><ActionForm action={setVoiceInterfaceEnabled.bind(null, guildId)}><input type="hidden" name="channelId" value={item.channelId} /><input type="hidden" name="enabled" value={item.enabled ? '' : 'on'} /><button type="submit">{item.enabled ? 'Вимкнути' : 'Увімкнути'}</button></ActionForm><ActionForm action={deleteVoiceInterface.bind(null, guildId)} successMessage="Панель видалено."><input type="hidden" name="channelId" value={item.channelId} /><button type="submit">Видалити панель</button></ActionForm></div>}
    </div>)}
    {editable && <ActionForm action={publishVoiceInterface.bind(null, guildId)} className="voice-form"><fieldset><legend>Опублікувати панель</legend><label>Текстовий канал<select name="channelId" required defaultValue=""><option value="" disabled>Виберіть канал</option>{channels.filter((channel) => channel.type === 0).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><p>Виберіть канали створення для цієї панелі. Якщо не вибрати жодного, панель діятиме для всіх.</p>{creators.map((creator) => <label className="voice-check" key={creator.id}><input type="checkbox" name="creatorIds" value={creator.id} /> {channels.find((channel) => channel.id === creator.channelId)?.name ?? 'Канал не знайдено'}</label>)}<button type="submit" className="action-link">Опублікувати</button></fieldset></ActionForm>}
  </section>;
}
