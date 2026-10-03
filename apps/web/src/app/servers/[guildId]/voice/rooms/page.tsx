import { requireGuildAccess } from '@/lib/guards';
import { Suspense } from 'react';
import { DataLoading } from '@/app/components/data-loading';
import { voiceRoomChannels, voiceRooms } from '@/lib/voice-data';
import { deleteVoiceRoom } from '../actions';
import { ActionForm } from '@/app/components/action-form';

async function RoomsContent({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'voice.view');
  const [rooms, channels] = await Promise.all([voiceRooms(guildId), voiceRoomChannels(guildId, access.guild.resourceRevision)]);
  return <section><h2 className="subheading">Активні кімнати</h2>
    {rooms.length === 0 ? <p className="empty-state">Активних кімнат немає.</p> : <div className="voice-table-wrap"><table className="voice-table"><thead><tr><th>Кімната</th><th>Власник</th><th>Канал створення</th><th>Учасники</th><th>Стан</th><th>Оновлено</th><th>Дії</th></tr></thead><tbody>{rooms.map((room) => {
      const channel = channels.find((item) => item.id === room.channelId);
      const creator = channels.find((item) => item.id === room.creatorId);
      return <tr key={room.channelId}><td>{channel?.name ?? 'Канал не знайдено'}</td><td>{room.ownerId ?? 'Немає'}</td><td>{creator?.name ?? 'Канал створення не знайдено'}</td><td>{room.memberCount}</td><td>{room.locked ? 'Закрито' : 'Відкрито'} · {room.hidden ? 'Приховано' : 'Не приховано'}</td><td>{new Date(room.updatedAt).toLocaleString('uk-UA')}</td><td>{channel && <a href={`https://discord.com/channels/${guildId}/${room.channelId}`} target="_blank" rel="noreferrer">Відкрити</a>}{access.permissions.has('voice.manage') && <ActionForm action={deleteVoiceRoom.bind(null, guildId)} successMessage="Кімнату видалено."><input type="hidden" name="channelId" value={room.channelId} /><label className="voice-check"><input type="checkbox" name="confirm" required /> Підтвердити видалення</label><button type="submit">Видалити</button></ActionForm>}</td></tr>;
    })}</tbody></table></div>}
    <p className="muted">Кількість учасників оновлюється після входу або виходу з кімнати.</p>
  </section>;
}

export default function RoomsPage(props: Parameters<typeof RoomsContent>[0]) {
  return <Suspense fallback={<section><h2 className="subheading">Активні кімнати</h2><DataLoading label="Завантаження кімнат…" /></section>}><RoomsContent {...props} /></Suspense>;
}
