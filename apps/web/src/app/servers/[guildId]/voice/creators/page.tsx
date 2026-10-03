import { Switch, Button } from '@/app/components/controls';
import { ResourceMultiSelect } from '@/app/components/resource-multiselect';
import { Select } from '@/app/components/select';
import { requireGuildAccess } from '@/lib/guards';
import { Suspense } from 'react';
import { DataLoading } from '@/app/components/data-loading';
import { voiceCreators, voiceRegions, voiceResources, voiceRooms } from '@/lib/voice-data';
import { defaultCreatorChannelName, type VoiceCreator } from '@scrt/validation';
import { ActionForm } from '@/app/components/action-form';
import { VoiceNameEditor } from '@/app/components/voice-name-editor';
import { deleteVoiceCreator, saveVoiceCreator } from '../actions';

const features = [
  { key: 'rename', label: 'Назва кімнати', help: 'Зміна назви кімнати.' },
  { key: 'userLimit', label: 'Ліміт учасників', help: 'Зміна ліміту учасників.' },
  { key: 'bitrate', label: 'Бітрейт', help: 'Зміна бітрейту кімнати.' },
  { key: 'region', label: 'Регіон', help: 'Вибір голосового регіону.' },
  { key: 'lock', label: 'Закрити кімнату', help: 'Заборонити новим учасникам входити.' },
  { key: 'hide', label: 'Приховати кімнату', help: 'Сховати канал від інших учасників.' },
  { key: 'permit', label: 'Дозволити доступ', help: 'Надати окремому учаснику доступ.' },
  { key: 'block', label: 'Заблокувати', help: 'Заборонити окремому учаснику вхід.' },
  { key: 'kick', label: 'Відключити учасника', help: 'Прибрати учасника з кімнати.' },
  { key: 'transfer', label: 'Передати власність', help: 'Призначити іншого власника.' },
  { key: 'claim', label: 'Стати власником', help: 'Отримання кімнати, власник якої вийшов.' },
  { key: 'reset', label: 'Скинути налаштування', help: 'Повернути початкові параметри кімнати.' },
  { key: 'delete', label: 'Видалити кімнату', help: 'Видалення кімнати.' },
  { key: 'chat', label: 'Чат кімнати', help: 'Відкриття та закриття чату кімнати.' },
] as const;

type Resources = Awaited<ReturnType<typeof voiceResources>>;
type Regions = Awaited<ReturnType<typeof voiceRegions>>;

function CreatorEditor({ guildId, creator, resources, regions, roomChannelIds }: { guildId: string; creator?: VoiceCreator; resources: Resources; regions: Regions; roomChannelIds: ReadonlySet<string> }) {
  const roles = resources.roles.filter((role) => role.id !== guildId);
  const channelName = resources.channels.find((channel) => channel.id === creator?.channelId)?.name;
  return <ActionForm action={saveVoiceCreator.bind(null, guildId)} className="voice-form creator-form">
    <fieldset className="settings-card">
      <legend>Канал створення</legend>
      <p className="field-help">Вхід у цей канал створює окрему голосову кімнату для учасника.</p>
      {creator
        ? <><input type="hidden" name="channelId" value={creator.channelId} /><input type="hidden" name="renameCreatorChannel" value="on" /><input type="hidden" name="originalCreatorChannelName" value={channelName ?? ''} /><label>Назва каналу створення<input name="creatorChannelName" maxLength={100} defaultValue={channelName ?? ''} required /><small>Змінює назву голосового каналу в Discord.</small></label></>
        : <div className="form-grid creator-channel-fields"><label>Голосовий канал<Select aria-label="Голосовий канал" searchable name="channelId" defaultValue="" required><option value="" disabled>Виберіть канал</option>{resources.channels.filter((channel) => channel.type === 2 && !roomChannelIds.has(channel.id)).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}<option value="new">Створити новий канал</option></Select><small>Тимчасові кімнати SCRT не можна призначити каналом створення.</small></label><label>Назва нового каналу<output className="creator-new-name-preview">{defaultCreatorChannelName}</output><input className="creator-new-name-input" name="creatorChannelName" maxLength={100} defaultValue={defaultCreatorChannelName} /><small>Назву можна змінити після вибору «Створити новий канал».</small></label></div>}
      <div className="form-grid"><label>Категорія нових кімнат<Select aria-label="Категорія нових кімнат" searchable name="targetCategoryId" defaultValue={creator?.targetCategoryId ?? ''}><option value="">У категорії каналу створення</option>{resources.channels.filter((channel) => channel.type === 4).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</Select><small>Тут з’являтимуться створені кімнати.</small></label>
      <Switch label="Створювати кімнати" help="Вимкнений канал не створює нових кімнат." name="enabled" defaultChecked={creator?.enabled ?? true}  /></div>
      <div className="form-grid">
        <label>Розташування кімнати<Select aria-label="Розташування кімнати" name="roomPlacement" defaultValue={creator?.roomPlacement ?? 'bottom'}><option value="above">Над каналом створення</option><option value="below">Під каналом створення</option><option value="top">На початку категорії</option><option value="bottom">У кінці категорії</option></Select><small>Якщо кімнати в іншій категорії, «над» означає початок, а «під» — кінець тієї категорії.</small></label>
        <label>Порядок кімнат<Select aria-label="Порядок кімнат" name="roomOrder" defaultValue={creator?.roomOrder ?? 'oldest_first'}><option value="oldest_first">Старіші зверху</option><option value="newest_first">Новіші зверху</option></Select><small>Порядок розміщення нових кімнат. Розташування наявних кімнат не змінюється.</small></label>
      </div>
    </fieldset>

    <fieldset className="settings-card">
      <legend>Налаштування нової кімнати</legend>
      <p className="field-help">Початкові налаштування кімнати. Доступні власнику дії визначаються нижче.</p>
      <div className="form-grid">
        <VoiceNameEditor defaultValue={creator?.nameTemplate ?? '🎧 {displayName}'} />
        <label>Ліміт учасників<input type="number" name="defaultUserLimit" min="0" max="99" defaultValue={creator?.defaultUserLimit ?? 0} /><small>0 — без обмеження.</small></label>
        <label>Бітрейт, біт/с<input type="number" name="defaultBitrate" min="8000" defaultValue={creator?.defaultBitrate ?? ''} placeholder="Стандартний" /><small>Залиште порожнім для стандартного значення Discord.</small></label>
        <label>Голосовий регіон<Select aria-label="Голосовий регіон" searchable name="defaultRtcRegion" defaultValue={creator?.defaultRtcRegion ?? ''}><option value="">Автоматично</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</Select><small>У режимі «Автоматично» регіон визначає Discord.</small></label>
      </div>
      <div className="toggle-grid">
        <Switch label="Закривати нові кімнати" help="Нові учасники не зможуть увійти без дозволу." name="defaultLocked" defaultChecked={creator?.defaultLocked ?? false}  />
        <Switch label="Приховувати нові кімнати" help="Канал не видно іншим учасникам." name="defaultHidden" defaultChecked={creator?.defaultHidden ?? false}  />
        <Switch label="Закритий чат" help="Повідомлення в чаті кімнати вимкнено." name="defaultChatClosed" defaultChecked={creator?.defaultChatClosed ?? false}  />
      </div>
    </fieldset>

    <fieldset className="settings-card settings-card-wide">
      <legend>Доступ за ролями</legend>
      <p className="field-help">Обмежте вхід до кімнати ролями або надайте окремим ролям право обходити її обмеження.</p>
      <div className="role-columns">
        <div><h3>Дозволені ролі</h3><p className="field-help">Якщо нічого не вибрано, діють звичайні дозволи Discord.</p><ResourceMultiSelect name="allowedRoleIds" label="Дозволені ролі" options={roles} defaultSelected={creator?.allowedRoleIds ?? []} /></div>
        <div><h3>Вхід без обмежень</h3><p className="field-help">Ці ролі можуть входити попри обмеження кімнати.</p><ResourceMultiSelect name="bypassRoleIds" label="Ролі без обмежень" options={roles} defaultSelected={creator?.bypassRoleIds ?? []} /></div>
      </div>
    </fieldset>

    <fieldset className="settings-card settings-card-wide">
      <legend>Можливості власника</legend>
      <p className="field-help">Дії, доступні власнику кімнати в панелі та командах Discord.</p>
      <div className="feature-grid">{features.map(({ key, label, help }) => <label key={key} className="voice-check feature-option"><input type="checkbox" name={'feature_' + key} defaultChecked={creator?.enabledFeatures[key] ?? true} /><span><strong>{label}</strong><small>{help}</small></span></label>)}</div>
    </fieldset>

    <fieldset className="settings-card settings-card-wide">
      <legend>Панель керування</legend>
      <p className="field-help">Де показувати кнопки керування кімнатою.</p>
      <label>Розташування<Select aria-label="Розташування" name="interfaceMode" defaultValue={creator?.interfaceMode ?? 'inherit'}><option value="inherit">За налаштуваннями модуля</option><option value="room">У кімнаті</option><option value="global">У спільному каналі</option><option value="both">В обох місцях</option><option value="none">Без панелі</option></Select></label>
    </fieldset>
    <div className="form-actions"><Button type="submit">Зберегти зміни</Button></div>
  </ActionForm>;
}

function CreatorDelete({ guildId, creatorId, channelName }: { guildId: string; creatorId: string; channelName: string }) {
  return <section className="danger-zone" aria-label="Видалення каналу створення">
    <div><h3>Видалити канал створення</h3><p>Видаліть лише налаштування SCRT, щоб залишити канал у Discord, або видаліть канал разом із налаштуваннями.</p></div>
    <div className="danger-actions">
      <ActionForm action={deleteVoiceCreator.bind(null, guildId)} successMessage="Налаштування каналу видалено."><input type="hidden" name="creatorId" value={creatorId} /><button type="submit" className="secondary-button">Прибрати налаштування</button></ActionForm>
      <ActionForm action={deleteVoiceCreator.bind(null, guildId)} successMessage="Канал і його налаштування видалено." confirmation={{ title: 'Видалити канал Discord?', description: 'Канал «' + channelName + '» та його налаштування SCRT буде видалено. Цю дію не можна скасувати.', actionLabel: 'Видалити канал' }}><input type="hidden" name="creatorId" value={creatorId} /><input type="hidden" name="alsoDeleteChannel" value="on" /><input type="hidden" name="confirmDelete" value="confirmed" /><button type="submit" className="danger-button">Видалити канал Discord</button></ActionForm>
    </div>
  </section>;
}

async function CreatorsContent({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'voice.view');
  const [creators, rooms, resources, regions] = await Promise.all([voiceCreators(guildId), voiceRooms(guildId), voiceResources(guildId, access.guild.resourceRevision), voiceRegions()]);
  const canManage = access.permissions.has('voice.manage');
  const roomChannelIds = new Set(rooms.map((room) => room.channelId));
  return <section className="creators-page">
    <div className="section-intro"><div><h2>Канали створення</h2><p>Голосові канали, вхід до яких створює окрему кімнату для учасника.</p></div><span className="count-badge">{creators.length}</span></div>
    {creators.length === 0 && <p className="empty-state">Канали створення ще не додано.</p>}
    {creators.map((creator) => {
      const channelName = resources.channels.find((channel) => channel.id === creator.channelId)?.name ?? 'Канал не знайдено';
      const roomCount = rooms.filter((room) => room.creatorId === creator.id).length;
      return <details key={creator.id} className="voice-item creator-card"><summary><span className="creator-summary"><strong>{channelName}</strong><span>{creator.nameTemplate} · Активних кімнат: {roomCount}</span></span><span className={'status-pill ' + (creator.enabled ? 'status-active' : '')}>{creator.enabled ? 'Активний' : 'Вимкнений'}</span></summary>
        {canManage ? <><CreatorEditor guildId={guildId} creator={creator} resources={resources} regions={regions} roomChannelIds={roomChannelIds} /><CreatorDelete guildId={guildId} creatorId={creator.id} channelName={channelName} /></> : <p className="field-help">Для зміни налаштувань потрібен дозвіл на керування голосовими каналами.</p>}
      </details>;
    })}
    {canManage && <details className="voice-item creator-card add-creator"><summary><span className="creator-summary"><strong>+ Додати канал створення</strong><span>Підключіть наявний голосовий канал або створіть новий.</span></span></summary><CreatorEditor guildId={guildId} resources={resources} regions={regions} roomChannelIds={roomChannelIds} /></details>}
  </section>;
}

export default function CreatorsPage(props: Parameters<typeof CreatorsContent>[0]) {
  return <Suspense fallback={<section className="creators-page"><h2 className="subheading">Канали створення</h2><DataLoading label="Завантаження каналів створення…" /></section>}><CreatorsContent {...props} /></Suspense>;
}

