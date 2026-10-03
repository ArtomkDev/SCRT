import { requireGuildAccess } from '@/lib/guards';
import { Suspense } from 'react';
import { DataLoading } from '@/app/components/data-loading';
import { voiceResources, voiceSettings } from '@/lib/voice-data';
import { ActionForm } from '@/app/components/action-form';
import { saveVoiceSettings } from '../actions';
import { Button, Input, Switch } from '@/app/components/controls';
import { Select } from '@/app/components/select';
import { DurationInput } from '@/app/components/duration-input';
import { ResourceMultiSelect } from '@/app/components/resource-multiselect';

async function SettingsContent({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'voice.view');
  const [settings, resources] = await Promise.all([voiceSettings(guildId), voiceResources(guildId, access.guild.resourceRevision)]);
  const editable = access.permissions.has('voice.manage');
  const roles = resources.roles.filter((role) => role.id !== guildId);
  return <section className="settings-page">
    <div className="section-intro"><div><h2>Налаштування модуля</h2><p>Створення кімнат, права власника та автоматичне видалення.</p></div></div>
    {!editable && <p className="form-feedback" role="status">Лише перегляд. Для змін потрібен дозвіл керувати голосовими каналами.</p>}
    <ActionForm action={saveVoiceSettings.bind(null, guildId)} className="voice-form settings-form settings-sections">
      <fieldset className="settings-card settings-section" id="module-enabled" tabIndex={-1}>
        <legend>Робота модуля</legend>
        <Switch label="Створювати голосові кімнати" help="SCRT створює кімнати після входу в канал створення." name="enabled" defaultChecked={settings.enabled} disabled={!editable} />
        <p className="field-help">Вимкнення зупиняє створення нових кімнат. Наявні кімнати залишаються до автоматичного або ручного видалення.</p>
      </fieldset>

      <fieldset className="settings-card settings-section">
        <legend>Видалення та зміна власника</legend>
        <p className="field-help">Дії після виходу власника або останнього учасника.</p>
        <div className="form-grid">
          <DurationInput name="cleanupDelaySeconds" label="Видалити порожню кімнату через" defaultSeconds={settings.cleanupDelaySeconds} min={0} max={3600} disabled={!editable} help="Після виходу останнього учасника. 0 — одразу." />
          <DurationInput name="ownerLeaveGraceSeconds" label="Час на повернення власника" defaultSeconds={settings.ownerLeaveGraceSeconds} min={0} max={3600} disabled={!editable} />
          <label>Якщо власник не повернувся<Select name="ownerExitBehavior" aria-label="Якщо власник не повернувся" defaultValue={settings.ownerExitBehavior} disabled={!editable}><option value="claimable">Дозволити іншому учаснику стати власником</option><option value="auto_transfer">Автоматично передати учаснику</option><option value="keep_owner">Залишити попереднього власника</option></Select></label>
          <label>Повторний вхід у канал створення<Select name="duplicateRoomPolicy" aria-label="Повторний вхід у канал створення" defaultValue={settings.duplicateRoomPolicy} disabled={!editable}><option value="reuse">Повернути в наявну кімнату</option><option value="allow">Створити ще одну кімнату</option></Select></label>
          <label>Кімнат на одного учасника<Input type="number" name="maxRoomsPerUser" min="1" max="5" defaultValue={settings.maxRoomsPerUser} disabled={!editable} /><small>Від 1 до 5 кімнат.</small></label>
        </div>
      </fieldset>

      <fieldset className="settings-card settings-section">
        <legend>Панель і журнал</legend>
        <p className="field-help">Розташування панелі керування та канал для журналу подій.</p>
        <div className="form-grid">
          <label>Панель за замовчуванням<Select name="defaultInterfaceMode" aria-label="Панель за замовчуванням" defaultValue={settings.defaultInterfaceMode} disabled={!editable}><option value="room">У кімнаті</option><option value="global">У спільному каналі</option><option value="both">В обох місцях</option><option value="none">Без панелі</option></Select><small>Канал створення може мати іншу панель.</small></label>
          <label>Канал журналу<Select name="logChannelId" aria-label="Канал журналу" defaultValue={settings.logChannelId ?? ''} searchable disabled={!editable}><option value="">Не вибрано</option>{resources.channels.filter((channel) => channel.type === 0).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</Select><small>Текстовий канал для подій голосового модуля.</small></label>
        </div>
      </fieldset>

      <fieldset className="settings-card settings-section">
        <legend>Вхід без обмежень</legend>
        <p className="field-help">Учасники з цими ролями можуть входити в кімнати попри встановлені обмеження.</p>
        <ResourceMultiSelect name="bypassRoleIds" label="Ролі" options={roles} defaultSelected={settings.bypassRoleIds} disabled={!editable} />
      </fieldset>
      {editable && <div className="form-actions"><Button type="submit">Зберегти налаштування</Button><span>Зміни застосовуються після збереження.</span></div>}
    </ActionForm>
  </section>;
}

export default function VoiceSettingsPage(props: Parameters<typeof SettingsContent>[0]) {
  return <div className="settings-page"><Suspense fallback={<section><h2 className="subheading">Налаштування</h2><DataLoading label="Завантаження налаштувань голосового модуля…" /></section>}><SettingsContent {...props} /></Suspense></div>;
}

