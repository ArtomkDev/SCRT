import { requireGuildAccess } from '@/lib/guards';
import { voiceResources, voiceSettings } from '@/lib/voice-data';
import { ActionForm } from '@/app/components/action-form';
import { saveVoiceSettings } from '../actions';

export default async function VoiceSettingsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'voice.view');
  const [settings, resources] = await Promise.all([voiceSettings(guildId), voiceResources(guildId, access.guild.resourceRevision)]);
  const editable = access.permissions.has('voice.manage');
  const roles = resources.roles.filter((role) => role.id !== guildId);
  return <section className="settings-page">
    <div className="section-intro"><div><h2>Налаштування модуля</h2><p>Створення кімнат, права власника та автоматичне видалення.</p></div></div>
    <ActionForm action={saveVoiceSettings.bind(null, guildId)} className="voice-form settings-form">
      <fieldset className="settings-card" id="module-enabled" tabIndex={-1}>
        <legend>Робота модуля</legend>
        <label className="voice-switch"><span><strong>Створювати голосові кімнати</strong><small>SCRT створює кімнати, коли учасники входять у канали створення.</small></span><input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={!editable} /></label>
        <p className="field-help">Вимкнення зупиняє створення нових кімнат. Наявні кімнати залишаються до автоматичного або ручного видалення.</p>
      </fieldset>

      <fieldset className="settings-card">
        <legend>Видалення та зміна власника</legend>
        <p className="field-help">Дії після виходу власника або останнього учасника.</p>
        <div className="form-grid">
          <label>Видалити порожню кімнату через<input type="number" name="cleanupDelaySeconds" min="0" max="3600" defaultValue={settings.cleanupDelaySeconds} disabled={!editable} /><small>Секунди після виходу останнього учасника. 0 — одразу.</small></label>
          <label>Час на повернення власника<input type="number" name="ownerLeaveGraceSeconds" min="0" max="3600" defaultValue={settings.ownerLeaveGraceSeconds} disabled={!editable} /><small>Секунди, протягом яких власник може повернутися.</small></label>
          <label>Якщо власник не повернувся<select name="ownerExitBehavior" defaultValue={settings.ownerExitBehavior} disabled={!editable}><option value="claimable">Дозволити іншому учаснику стати власником</option><option value="auto_transfer">Автоматично передати учаснику</option><option value="keep_owner">Залишити попереднього власника</option></select></label>
          <label>Повторний вхід у канал створення<select name="duplicateRoomPolicy" defaultValue={settings.duplicateRoomPolicy} disabled={!editable}><option value="reuse">Повернути в наявну кімнату</option><option value="allow">Створити ще одну кімнату</option></select></label>
          <label>Кімнат на одного учасника<input type="number" name="maxRoomsPerUser" min="1" max="5" defaultValue={settings.maxRoomsPerUser} disabled={!editable} /><small>Від 1 до 5 кімнат.</small></label>
        </div>
      </fieldset>

      <fieldset className="settings-card">
        <legend>Панель і журнал</legend>
        <p className="field-help">Розташування панелі керування та канал для журналу подій.</p>
        <div className="form-grid">
          <label>Панель за замовчуванням<select name="defaultInterfaceMode" defaultValue={settings.defaultInterfaceMode} disabled={!editable}><option value="room">У кімнаті</option><option value="global">У спільному каналі</option><option value="both">В обох місцях</option><option value="none">Без панелі</option></select><small>Для окремого каналу створення можна вибрати іншу панель.</small></label>
          <label>Канал журналу<select name="logChannelId" defaultValue={settings.logChannelId ?? ''} disabled={!editable}><option value="">Не вибрано</option>{resources.channels.filter((channel) => channel.type === 0).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><small>Текстовий канал для подій голосового модуля.</small></label>
        </div>
      </fieldset>

      <fieldset className="settings-card">
        <legend>Вхід без обмежень</legend>
        <p className="field-help">Учасники з цими ролями можуть входити в кімнати попри встановлені обмеження.</p>
        <div className="choice-list">{roles.length ? roles.map((role) => <label key={role.id} className="voice-check"><input type="checkbox" name="bypassRoleIds" value={role.id} defaultChecked={settings.bypassRoleIds.includes(role.id)} disabled={!editable} /><span>{role.name}</span></label>) : <p className="empty-state">Додаткових ролей немає.</p>}</div>
      </fieldset>
      {editable && <div className="form-actions"><button type="submit" className="action-link">Зберегти налаштування</button></div>}
    </ActionForm>
  </section>;
}

