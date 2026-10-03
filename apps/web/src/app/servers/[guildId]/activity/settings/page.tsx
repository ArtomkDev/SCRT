import { ActionForm } from '@/app/components/action-form';
import { requireGuildAccess } from '@/lib/guards';
import { Suspense } from 'react';
import { RowsLoading, StatusLoading } from '@/app/components/data-loading';
import { ActivitySettingsLoading } from '../loading-content';
import { activityHealth, activityProfiles, activitySettings, activityObservedGames } from '@/lib/activity-data';
import { voiceResources } from '@/lib/voice-data';
import { saveActivitySettings, setActivityGameIgnored } from '../actions';
import { InlineAction } from '@/app/components/inline-action';
import { UserExclusions } from './user-exclusions';
import { ActivityIcon } from '@/app/components/activity-artwork';
import { activityArtworks, activityArtworkHealth } from '@/lib/activity-artwork';
import { ArtworkControls } from './artwork-controls';
import { ArtworkBulk } from './artwork-bulk';
import { Button, Checkbox, Switch } from '@/app/components/controls';
import { Select } from '@/app/components/select';
import { DurationInput } from '@/app/components/duration-input';
import { ResourceMultiSelect } from '@/app/components/resource-multiselect';

async function SettingsContent({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'activity.view');
  const [settings, resources] = await Promise.all([activitySettings(guildId), voiceResources(guildId, access.guild.resourceRevision)]);
  const profiles = await activityProfiles(guildId, settings.exclusions.userIds.join(','));
  const editable = access.permissions.has('activity.manage');
  const timezones = Array.from(new Set([settings.streak.timezone, 'Europe/Kyiv', 'Europe/Warsaw', 'Europe/London', 'America/New_York', 'UTC', ...Intl.supportedValuesOf('timeZone')]));
  return <section className="settings-page"><div className="section-intro"><div><h2>Налаштування активності</h2><p>Статистика метаданих. Вміст повідомлень, голосу та демонстрації не зберігається.</p></div></div>
    {!editable && <p className="form-feedback" role="status">Лише перегляд. Для змін потрібен дозвіл керувати активністю.</p>}
    <ActionForm action={saveActivitySettings.bind(null, guildId)} className="voice-form activity-settings settings-sections">
    <fieldset className="settings-card settings-section" id="module-enabled"><legend>Основне</legend><Switch label="Модуль активності" help="Нові події враховуються лише коли модуль увімкнено. Історія зберігається." name="enabled" defaultChecked={settings.enabled} disabled={!editable} /></fieldset>
    <fieldset className="settings-card settings-section"><legend>Відстеження</legend><div className="toggle-grid">{([['messages', 'Повідомлення'], ['voice', 'Voice'], ['streaming', 'Демонстрація екрана'], ['games', 'Ігри та застосунки'], ['voiceStreaks', 'Voice-серії']] as const).map(([key, title]) => <Checkbox key={key} name={key} defaultChecked={settings.tracking[key]} disabled={!editable} label={title} />)}</div></fieldset>
    <fieldset className="settings-card settings-section"><legend>Час і серії</legend><div className="form-grid"><label>Часовий пояс<Select name="timezone" aria-label="Часовий пояс" defaultValue={settings.streak.timezone} searchable disabled={!editable}>{timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</Select></label>{([['voiceMinimum', 'Мінімальна сесія Voice', settings.voice.minimumSessionSeconds], ['streamMinimum', 'Мінімальна демонстрація', settings.streaming.minimumSessionSeconds], ['gameMinimum', 'Мінімальна сесія активності', settings.games.minimumSessionSeconds], ['streakMinimum', 'Voice за день для серії', settings.streak.minimumVoiceSecondsPerDay]] as const).map(([name, label, value]) => <DurationInput key={name} name={name} label={label} defaultSeconds={value} disabled={!editable} help={name === 'streakMinimum' ? 'Мінімальний час Voice, після якого день зараховується до серії.' : undefined} />)}<DurationInput name="voiceReturnGrace" label="Час на повернення у Voice" defaultSeconds={settings.voice.returnGraceSeconds} min={0} disabled={!editable} help="0 — вихід завершує серію. Час поза Voice не додається; перехід між дозволеними каналами цього сервера зберігає серію." /></div><p className="field-help">Зміна часового поясу чи порогу починає нову поточну серію. Найдовша історична серія зберігається; минулі дні не перераховуються.</p></fieldset>
    <fieldset className="settings-card settings-section"><legend>Виключення</legend><Checkbox name="ignoreAfkChannel" defaultChecked={settings.exclusions.ignoreAfkChannel} disabled={!editable} label="Не враховувати AFK-канал" /><p className="field-help">Боти та особисті повідомлення завжди ігноруються. Для гілок діють виключення батьківського каналу і категорії.</p><div className="form-grid">{([['channelIds', 'Канали', resources.channels.filter((channel) => channel.type !== 4)], ['categoryIds', 'Категорії', resources.channels.filter((channel) => channel.type === 4)], ['roleIds', 'Ролі', resources.roles]] as const).map(([key, title, options]) => <ResourceMultiSelect key={key} name={key} label={title} options={options.map((option) => ({ id: option.id, name: option.name ?? 'Без назви' }))} defaultSelected={settings.exclusions[key]} disabled={!editable} />)}</div><UserExclusions guildId={guildId} editable={editable} selected={settings.exclusions.userIds.map((userId) => ({ userId, displayName: profiles.find((profile) => profile.userId === userId)?.displayName ?? 'Учасник більше недоступний' }))} /></fieldset>
    {editable && <div className="form-actions"><Button type="submit">Зберегти налаштування</Button><span>Зміни застосовуються після збереження.</span></div>}
  </ActionForm></section>;
}

async function TrackerStatus({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireGuildAccess(guildId, 'activity.view');
  const [settings, health] = await Promise.all([activitySettings(guildId), activityHealth(guildId)]);
  const fresh = health !== null && Date.now() - health.observedAt < 600_000;
  const working = fresh && health?.connected;
  const trackerState = (enabled: boolean) => !settings.enabled || !enabled ? 'Вимкнено' : working ? 'Працює' : 'Немає свіжого зв’язку з ботом';
  return <dl className="activity-health"><dt>Повідомлення</dt><dd>{trackerState(settings.tracking.messages)}</dd><dt>Voice</dt><dd>{trackerState(settings.tracking.voice)}</dd><dt>Демонстрація екрана</dt><dd>{trackerState(settings.tracking.streaming)}</dd><dt>Ігри та застосунки</dt><dd>{!settings.enabled || !settings.tracking.games ? 'Вимкнено' : !fresh ? 'Стан невідомий' : health?.presence ? trackerState(true) : 'Presence Intent недоступний'}</dd><dt>Агрегація</dt><dd>{working && health?.aggregation ? 'Остання операція успішна' : 'Очікує перевірки або має помилку'}</dd><dt>Відновлення</dt><dd>{working && health?.recovery ? 'Завершено' : 'Не підтверджено'}</dd>{fresh && <><dt>Активні сесії</dt><dd>Voice: {health?.activeVoice} · демонстрація: {health?.activeStream} · ігри: {health?.activeGames}</dd></>}</dl>;
}

async function ObservedActivities({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'activity.view');
  const query = await searchParams;
  const after = typeof query.observedAfter === 'string' && /^[a-f0-9]{64}$/.test(query.observedAfter) ? query.observedAfter : undefined;
  const [settings, observed] = await Promise.all([activitySettings(guildId), activityObservedGames(guildId, after)]);
  const editable = access.permissions.has('activity.manage');
  const artwork = await activityArtworks(guildId, observed.games);
  const byKey = new Map(artwork.map((item) => [item.gameKey, item]));
  return <><p className="field-help">Ігноровані ігри та застосунки приховані з аналітики; новий час не накопичується після узгодження трекера. Історія зберігається та повертається після відновлення відстеження.</p><ul className="activity-observed">{observed.games.map((game) => {
    const ignored = settings.games.ignoredGameKeys.includes(game.gameKey);
    return <li key={game.gameKey}><span className="activity-identity"><ActivityIcon gameKey={game.gameKey} name={game.displayName} artwork={byKey.get(game.gameKey)} /><span>{game.displayName}</span></span><small>{ignored ? 'Ігнорується' : 'Відстежується'}</small>{editable && <><ActionForm key={String(ignored)} action={setActivityGameIgnored.bind(null, guildId)} trackChanges={false}><input type="hidden" name="gameKey" value={game.gameKey} /><input type="hidden" name="mode" value={ignored ? 'track' : 'ignore'} /><button className="secondary-button" type="submit">{ignored ? 'Відстежувати' : 'Ігнорувати'}</button></ActionForm><ArtworkControls guildId={guildId} identity={game} artwork={byKey.get(game.gameKey)} /></>}</li>;
  })}</ul>{!observed.games.length && <p className="empty-state">Discord ще не передав жодної відстежуваної активності.</p>}{after && <InlineAction className="activity-more" direction="back" href={'/servers/' + guildId + '/activity/settings'}>Початок списку</InlineAction>}{observed.next && <InlineAction className="activity-more" href={'?observedAfter=' + observed.next}>Наступні активності</InlineAction>}</>;
}

async function ArtworkProviders({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'activity.view');
  if (!access.permissions.has('activity.manage')) return null;
  const providers = await activityArtworkHealth(guildId);
  const labels: Record<string, string> = { available: 'Доступно', configured: 'Налаштовано · ще не перевірено', not_configured: 'Не налаштовано', ok: 'Останній запит успішний', authorization_error: 'Помилка авторизації', rate_limited: 'Ліміт запитів · повтор пізніше', unavailable: 'Тимчасово недоступно' };
  const names: Record<string, string> = { discord: 'Discord', steamgriddb: 'SteamGridDB', igdb: 'IGDB', 'simple-icons': 'Simple Icons', brand: 'Іконки видавців', generated: 'Резервне оформлення' };
  return <section className="detail-panel"><h2>Джерела оформлення</h2><dl className="activity-health activity-artwork-health">{providers.map((provider) => <div key={provider.id}><dt>{names[provider.id]}</dt><dd>{labels[provider.status] ?? 'Стан невідомий'}</dd></div>)}</dl><ArtworkBulk guildId={guildId} /></section>;
}

export default function ActivitySettingsPage(props: Parameters<typeof ObservedActivities>[0]) {
  return <div className="settings-page"><Suspense fallback={<ActivitySettingsLoading />}><SettingsContent {...props} /></Suspense><section className="detail-panel"><h2>Ігри та застосунки</h2><Suspense fallback={<RowsLoading label="Завантаження активностей…" />}><ObservedActivities {...props} /></Suspense></section><Suspense fallback={<section className="detail-panel"><h2>Джерела оформлення</h2><StatusLoading label="Завантаження джерел оформлення…" labels={["Discord", "SteamGridDB", "IGDB", "Simple Icons", "Іконки видавців", "Резервне оформлення"]} /></section>}><ArtworkProviders params={props.params} /></Suspense><section className="detail-panel"><h2>Стан</h2><Suspense fallback={<StatusLoading label="Завантаження стану трекерів…" labels={["Повідомлення", "Voice", "Демонстрація екрана", "Ігри та застосунки", "Агрегація", "Відновлення"]} />}><TrackerStatus params={props.params} /></Suspense><p className="field-help">Для ігор та застосунків увімкніть Discord Developer Portal → Bot → Privileged Gateway Intents → Presence Intent, потім перезапустіть бота. Discord показує лише доступні йому активності типу Playing. Message Content Intent не потрібен.</p></section></div>;
}
