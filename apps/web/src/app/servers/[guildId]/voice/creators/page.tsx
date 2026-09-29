import { requireGuildAccess } from '@/lib/guards';
import { voiceCreators, voiceRegions, voiceResources, voiceRooms } from '@/lib/voice-data';
import { defaultCreatorChannelName, type VoiceCreator } from '@scrt/validation';
import { ActionForm } from '@/app/components/action-form';
import { VoiceNameEditor } from '@/app/components/voice-name-editor';
import { deleteVoiceCreator, saveVoiceCreator } from '../actions';

const features = [
  { key: 'rename', label: 'Назва кімнати', help: 'Власник може перейменувати свою кімнату.' },
  { key: 'userLimit', label: 'Ліміт учасників', help: 'Власник може змінити кількість місць.' },
  { key: 'bitrate', label: 'Бітрейт', help: 'Власник може змінити якість звуку.' },
  { key: 'region', label: 'Регіон', help: 'Власник може вибрати голосовий регіон.' },
  { key: 'lock', label: 'Закрити кімнату', help: 'Заборонити новим учасникам входити.' },
  { key: 'hide', label: 'Приховати кімнату', help: 'Сховати канал від інших учасників.' },
  { key: 'permit', label: 'Дозволити доступ', help: 'Надати окремому учаснику доступ.' },
  { key: 'block', label: 'Заблокувати', help: 'Заборонити окремому учаснику вхід.' },
  { key: 'kick', label: 'Відключити учасника', help: 'Прибрати учасника з кімнати.' },
  { key: 'transfer', label: 'Передати власність', help: 'Призначити іншого власника.' },
  { key: 'claim', label: 'Забрати кімнату', help: 'Дозволити забрати кімнату без власника.' },
  { key: 'reset', label: 'Скинути налаштування', help: 'Повернути початкові параметри кімнати.' },
  { key: 'delete', label: 'Видалити кімнату', help: 'Власник може закрити свою кімнату.' },
  { key: 'chat', label: 'Чат кімнати', help: 'Власник може керувати чатом.' },
] as const;

type Resources = Awaited<ReturnType<typeof voiceResources>>;
type Regions = Awaited<ReturnType<typeof voiceRegions>>;

function CreatorEditor({ guildId, creator, resources, regions, roomChannelIds }: { guildId: string; creator?: VoiceCreator; resources: Resources; regions: Regions; roomChannelIds: ReadonlySet<string> }) {
  const roles = resources.roles.filter((role) => role.id !== guildId);
  const channelName = resources.channels.find((channel) => channel.id === creator?.channelId)?.name;
  return <ActionForm action={saveVoiceCreator.bind(null, guildId)} className="voice-form creator-form">
    <fieldset className="settings-card">
      <legend>Канал створення</legend>
      <p className="field-help">Коли учасник заходить у цей голосовий канал, SCRT створює для нього окрему кімнату.</p>
      {creator
        ? <><input type="hidden" name="channelId" value={creator.channelId} /><input type="hidden" name="renameCreatorChannel" value="on" /><input type="hidden" name="originalCreatorChannelName" value={channelName ?? ''} /><label>Назва Creator-каналу<input name="creatorChannelName" maxLength={100} defaultValue={channelName ?? ''} required /><small>Змінює назву голосового каналу в Discord.</small></label></>
        : <div className="form-grid creator-channel-fields"><label>Голосовий канал<select name="channelId" defaultValue="" required><option value="" disabled>Виберіть канал</option>{resources.channels.filter((channel) => channel.type === 2 && !roomChannelIds.has(channel.id)).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}<option value="new">Створити новий канал</option></select><small>Тимчасові кімнати SCRT не можна призначити Creator-каналом.</small></label><label>Назва нового каналу<output className="creator-new-name-preview">{defaultCreatorChannelName}</output><input className="creator-new-name-input" name="creatorChannelName" maxLength={100} defaultValue={defaultCreatorChannelName} /><small>Назву можна змінити після вибору «Створити новий канал».</small></label></div>}
      <div className="form-grid"><label>Категорія нових кімнат<select name="targetCategoryId" defaultValue={creator?.targetCategoryId ?? ''}><option value="">У категорії Creator-каналу</option>{resources.channels.filter((channel) => channel.type === 4).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><small>Тут з’являтимуться створені кімнати.</small></label>
      <label className="voice-switch"><span><strong>Creator увімкнено</strong><small>Вимкнений канал не створює нових кімнат.</small></span><input type="checkbox" name="enabled" defaultChecked={creator?.enabled ?? true} /></label></div>
      <div className="form-grid">
        <label>Місце нової кімнати<select name="roomPlacement" defaultValue={creator?.roomPlacement ?? 'bottom'}><option value="above">Над Creator-каналом</option><option value="below">Під Creator-каналом</option><option value="top">На початку категорії</option><option value="bottom">У кінці категорії</option></select><small>Якщо кімнати в іншій категорії, «над» означає початок, а «під» — кінець тієї категорії.</small></label>
        <label>Порядок кімнат<select name="roomOrder" defaultValue={creator?.roomOrder ?? 'oldest_first'}><option value="oldest_first">Старіші зверху</option><option value="newest_first">Новіші зверху</option></select><small>Визначає порядок кімнат, створених цим Creator-каналом. Наявні кімнати не переставляються.</small></label>
      </div>
    </fieldset>

    <fieldset className="settings-card">
      <legend>Нова кімната</legend>
      <p className="field-help">Параметри, з якими SCRT створює кімнату. Власник зможе змінювати лише дозволені нижче функції.</p>
      <div className="form-grid">
        <VoiceNameEditor defaultValue={creator?.nameTemplate ?? '🎧 {displayName}'} />
        <label>Ліміт учасників<input type="number" name="defaultUserLimit" min="0" max="99" defaultValue={creator?.defaultUserLimit ?? 0} /><small>0 означає без обмеження.</small></label>
        <label>Бітрейт, біт/с<input type="number" name="defaultBitrate" min="8000" defaultValue={creator?.defaultBitrate ?? ''} placeholder="Стандартний" /><small>Залиште порожнім для стандартного значення Discord.</small></label>
        <label>Голосовий регіон<select name="defaultRtcRegion" defaultValue={creator?.defaultRtcRegion ?? ''}><option value="">Автоматично</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select><small>Автоматичний вибір підходить для більшості серверів.</small></label>
      </div>
      <div className="toggle-grid">
        <label className="voice-switch"><span><strong>Спочатку закрита</strong><small>Нові учасники не зможуть увійти без дозволу.</small></span><input type="checkbox" name="defaultLocked" defaultChecked={creator?.defaultLocked ?? false} /></label>
        <label className="voice-switch"><span><strong>Спочатку прихована</strong><small>Канал не видно іншим учасникам.</small></span><input type="checkbox" name="defaultHidden" defaultChecked={creator?.defaultHidden ?? false} /></label>
        <label className="voice-switch"><span><strong>Закритий чат</strong><small>Повідомлення в чаті кімнати вимкнено.</small></span><input type="checkbox" name="defaultChatClosed" defaultChecked={creator?.defaultChatClosed ?? false} /></label>
      </div>
    </fieldset>

    <fieldset className="settings-card settings-card-wide">
      <legend>Доступ за ролями</legend>
      <p className="field-help">Обмежте вхід до кімнати ролями або надайте окремим ролям право обходити її обмеження.</p>
      <div className="role-columns">
        <div><h3>Дозволені ролі</h3><p className="field-help">Якщо нічого не вибрано, діють звичайні дозволи Discord.</p><div className="choice-list">{roles.length ? roles.map((role) => <label key={role.id} className="voice-check"><input type="checkbox" name="allowedRoleIds" value={role.id} defaultChecked={creator?.allowedRoleIds.includes(role.id)} /><span>{role.name}</span></label>) : <p className="empty-state">Додаткових ролей немає.</p>}</div></div>
        <div><h3>Ролі з обходом</h3><p className="field-help">Ці ролі можуть входити попри обмеження кімнати.</p><div className="choice-list">{roles.length ? roles.map((role) => <label key={role.id} className="voice-check"><input type="checkbox" name="bypassRoleIds" value={role.id} defaultChecked={creator?.bypassRoleIds.includes(role.id)} /><span>{role.name}</span></label>) : <p className="empty-state">Додаткових ролей немає.</p>}</div></div>
      </div>
    </fieldset>

    <fieldset className="settings-card settings-card-wide">
      <legend>Можливості власника</legend>
      <p className="field-help">Виберіть дії, які власник зможе виконувати зі своєю кімнатою через панель або команду.</p>
      <div className="feature-grid">{features.map(({ key, label, help }) => <label key={key} className="voice-check feature-option"><input type="checkbox" name={'feature_' + key} defaultChecked={creator?.enabledFeatures[key] ?? true} /><span><strong>{label}</strong><small>{help}</small></span></label>)}</div>
    </fieldset>

    <fieldset className="settings-card settings-card-wide">
      <legend>Панель керування</legend>
      <p className="field-help">Визначте, де власник побачить кнопки керування кімнатою.</p>
      <label>Розташування<select name="interfaceMode" defaultValue={creator?.interfaceMode ?? 'inherit'}><option value="inherit">За налаштуваннями модуля</option><option value="room">У кімнаті</option><option value="global">У спільному каналі</option><option value="both">В обох місцях</option><option value="none">Без панелі</option></select></label>
    </fieldset>
    <div className="form-actions"><button type="submit" className="action-link">Зберегти зміни</button><span>Зміни буде збережено для цього Creator-каналу.</span></div>
  </ActionForm>;
}

function CreatorDelete({ guildId, creatorId, channelName }: { guildId: string; creatorId: string; channelName: string }) {
  return <section className="danger-zone" aria-label="Видалення Creator">
    <div><h3>Видалити Creator</h3><p>Можна прибрати лише налаштування SCRT або разом із ними видалити голосовий канал Discord.</p></div>
    <div className="danger-actions">
      <ActionForm action={deleteVoiceCreator.bind(null, guildId)} successMessage="Налаштування Creator видалено."><input type="hidden" name="creatorId" value={creatorId} /><button type="submit" className="secondary-button">Прибрати налаштування</button></ActionForm>
      <ActionForm action={deleteVoiceCreator.bind(null, guildId)} successMessage="Creator і канал видалено." confirmation={{ title: 'Видалити канал Discord?', description: 'Канал «' + channelName + '» та його налаштування SCRT буде видалено. Цю дію не можна скасувати.', actionLabel: 'Видалити канал' }}><input type="hidden" name="creatorId" value={creatorId} /><input type="hidden" name="alsoDeleteChannel" value="on" /><input type="hidden" name="confirmDelete" value="confirmed" /><button type="submit" className="danger-button">Видалити канал Discord</button></ActionForm>
    </div>
  </section>;
}

export default async function CreatorsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'voice.view');
  const [creators, rooms, resources, regions] = await Promise.all([voiceCreators(guildId), voiceRooms(guildId), voiceResources(guildId, access.guild.resourceRevision), voiceRegions()]);
  const canManage = access.permissions.has('voice.manage');
  const roomChannelIds = new Set(rooms.map((room) => room.channelId));
  return <section className="creators-page">
    <div className="section-intro"><div><h2>Creator-канали</h2><p>Керуйте каналами, які створюють персональні голосові кімнати.</p></div><span className="count-badge">{creators.length}</span></div>
    {creators.length === 0 && <p className="empty-state">Creator-каналів ще немає. Додайте перший канал нижче.</p>}
    {creators.map((creator) => {
      const channelName = resources.channels.find((channel) => channel.id === creator.channelId)?.name ?? 'Канал не знайдено';
      const roomCount = rooms.filter((room) => room.creatorId === creator.id).length;
      return <details key={creator.id} className="voice-item creator-card"><summary><span className="creator-summary"><strong>{channelName}</strong><span>{creator.nameTemplate} · {roomCount} активних кімнат</span></span><span className={'status-pill ' + (creator.enabled ? 'status-active' : '')}>{creator.enabled ? 'Активний' : 'Вимкнений'}</span></summary>
        {canManage ? <><CreatorEditor guildId={guildId} creator={creator} resources={resources} regions={regions} roomChannelIds={roomChannelIds} /><CreatorDelete guildId={guildId} creatorId={creator.id} channelName={channelName} /></> : <p className="field-help">Для зміни налаштувань потрібен дозвіл на керування голосовими каналами.</p>}
      </details>;
    })}
    {canManage && <details className="voice-item creator-card add-creator"><summary><span className="creator-summary"><strong>+ Додати Creator-канал</strong><span>Підключіть наявний голосовий канал або створіть новий.</span></span></summary><CreatorEditor guildId={guildId} resources={resources} regions={regions} roomChannelIds={roomChannelIds} /></details>}
  </section>;
}

