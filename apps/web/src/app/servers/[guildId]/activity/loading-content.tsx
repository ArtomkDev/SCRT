import { activityMetrics, type ActivityMetric, type ActivityPeriod } from '@scrt/shared';
import { LoadingValue, MetricsLoading, RowsLoading, SettingsLoading, TableLoading } from '@/app/components/data-loading';
import { InlineAction } from '@/app/components/inline-action';
import { MetricLinks, PeriodLinks } from './period-links';

export const summaryLabels = {
  overview: ['Повідомлення', 'Voice', 'Демонстрація екрана', 'Активні учасники'],
  messages: ['Повідомлення', 'Активні автори', 'Середньо на активного автора'],
  voice: [activityMetrics.voiceSeconds.label, activityMetrics.streamSeconds.label, 'Учасники Voice'],
};
export const gameSummaryLabels = ['Загальний час', 'Учасники', 'Сесії', 'Остання активність'];
export const streakLabels = ['Поточна серія', 'Найдовша серія', 'Остання врахована активність'];
export const contributorColumns = ['#', 'Учасник', 'Час', 'Внесок', 'Сесії', 'Остання активність'];

export function GamesLoading({ member = false }: { member?: boolean }) {
  return <TableLoading label="Завантаження активностей…" columns={['Активність', 'Час', member ? 'Частка активності' : 'Учасники', 'Сесії', ...(member ? [] : ['Остання активність']), 'Дії']} className="activity-table activity-games-table" wrapperClassName="activity-table-scroll activity-games-scroll" />;
}

export function RankingLoading({ title }: { title: string }) {
  return <section className="detail-panel"><h3>{title}</h3><RowsLoading label="Завантаження рейтингу…" /></section>;
}

export function MemberStatsLoading() {
  return <><MetricsLoading labels={summaryLabels.overview.slice(0, 3)} /><h3 className="subheading">Безперервний Voice</h3><VoiceRunNoteLoading /><MetricsLoading labels={['Найдовший безперервний час']} className="" /><h3 className="subheading">Voice-серії</h3><StreakNoteLoading /><MetricsLoading labels={streakLabels} className="" /></>;
}

export function StreakNoteLoading() {
  return <p className="field-help">Серії не залежать від вибраного періоду. День серії зараховується після <LoadingValue /> у Voice.</p>;
}
export function VoiceRunNoteLoading() {
  return <p className="field-help">Рекорд безперервного Voice за весь час. Перехід між дозволеними каналами цього сервера зберігає серію. На повернення після виходу є <LoadingValue />; час поза Voice не зараховується. Виключені канали, ролі та учасники завершують серію. Рекорд зараховується від <LoadingValue /> у Voice.</p>;
}

export function GameContentLoading({ path, period }: { path?: string; period?: ActivityPeriod }) {
  return <><div className="activity-artwork-hero" aria-label="Завантаження профілю активності…" aria-busy="true"><div className="activity-artwork-heading"><span className="activity-avatar" style={{ width: 64, height: 64 }} aria-hidden="true" /><div><h2><LoadingValue width="18ch" /></h2><LoadingValue width="10ch" /></div></div></div><PeriodLinks path={path} period={period} /><MetricsLoading labels={gameSummaryLabels} className="activity-summary activity-game-metrics" /><section className="detail-panel activity-contributors"><h3>Внесок учасників</h3><TableLoading label="Завантаження учасників…" columns={contributorColumns} className="activity-table activity-contributors-table" /></section></>;
}

export function ActivitySettingsLoading() {
  return <SettingsLoading title="Налаштування активності" label="Завантаження налаштувань активності…" sections={[
    { title: 'Основне', fields: ['Модуль активності'], control: 'switch' },
    { title: 'Відстеження', fields: ['Повідомлення', 'Voice', 'Демонстрація екрана', 'Ігри та застосунки', 'Voice-серії'], control: 'checkbox' },
    { title: 'Час і серії', fields: ['Часовий пояс', 'Мінімальна сесія Voice', 'Мінімальна демонстрація', 'Мінімальна сесія активності', 'Voice за день для серії', 'Час на повернення у Voice'] },
    { title: 'Виключення', fields: ['Не враховувати AFK-канал', 'Канали', 'Категорії', 'Ролі', 'Користувачі'] },
  ]} />;
}

type ActivityView = 'overview' | 'messages' | 'voice' | 'games' | 'leaderboard' | 'members' | 'member' | 'game';
const intros = {
  overview: ['Огляд', 'Що відбувається на сервері за вибраний період. Активні учасники — автори повідомлень, учасники Voice або демонстрації екрана.'],
  messages: ['Повідомлення', 'Кожне початкове повідомлення враховується один раз. Редагування та видалення не змінюють лічильник.'],
  voice: ['Voice', 'Час у дозволених каналах, зокрема з mute/deafen. Час демонстрації екрана входить також у час Voice.'],
  games: ['Ігри та застосунки', 'Час, учасники та сесії відстежуваних активностей.'],
  leaderboard: ['Рейтинг', 'Порівняйте учасників за вибраним показником.'],
  members: ['Учасники', 'Учасники зі збереженою активністю.'],
};

export function ActivityPageLoading({ view = 'overview', guildId, period = 'all', path: detailPath, metric }: { view?: ActivityView; guildId?: string; period?: ActivityPeriod; path?: string; metric?: ActivityMetric }) {
  const intro = view === 'member' || view === 'game' ? null : intros[view];
  const path = detailPath ?? (guildId && view !== 'member' && view !== 'game' ? `/servers/${guildId}/activity${view === 'overview' ? '' : '/' + view}` : undefined);
  return <section className={view === 'game' ? 'activity-game-detail' : undefined} aria-label="Перевірка стану активності…" aria-busy="true">
    {guildId && (view === 'member' || view === 'game') && <InlineAction className="activity-more" direction="back" href={`/servers/${guildId}/activity/${view === 'member' ? 'members' : 'games'}`}>{view === 'member' ? 'Учасники' : 'Ігри та застосунки'}</InlineAction>}
    {intro && <div className="section-intro"><div><h2>{intro[0]}</h2><p>{intro[1]}</p></div></div>}
    {view === 'member' && <div className="section-intro"><div><h2><LoadingValue width="18ch" /></h2><p><LoadingValue width="12ch" /></p></div></div>}
    {view === 'leaderboard' && <MetricLinks path={path} period={period} metric={metric} />}
    {view !== 'members' && view !== 'game' && (view !== 'leaderboard' || !metric || activityMetrics[metric].periodAware) && <PeriodLinks path={path} period={period} metric={metric} />}
    {view === 'overview' && <><MetricsLoading labels={summaryLabels.overview} /><div className="voice-columns"><RankingLoading title="Найактивніші в чаті" /><RankingLoading title="Найактивніші у Voice" /></div><section className="detail-panel"><h3>Найпопулярніші ігри та застосунки</h3><GamesLoading /></section><StreakNoteLoading /><RankingLoading title="Поточні Voice-серії" /></>}
    {view === 'messages' && <><MetricsLoading labels={summaryLabels.messages} /><RankingLoading title="Топ повідомлень" /></>}
    {view === 'voice' && <><MetricsLoading labels={summaryLabels.voice} /><div className="voice-columns"><RankingLoading title="Топ Voice" /><RankingLoading title="Топ демонстрації екрана" /></div><VoiceRunNoteLoading /><RankingLoading title="Топ безперервного Voice" /><h2 className="subheading">Voice-серії</h2><StreakNoteLoading /><div className="voice-columns"><RankingLoading title="Поточні серії" /><RankingLoading title="Найдовші серії" /></div></>}
    {view === 'games' && <GamesLoading />}
    {view === 'leaderboard' && <>{metric && !activityMetrics[metric].periodAware && (metric === 'longestVoiceRunSeconds' ? <VoiceRunNoteLoading /> : <StreakNoteLoading />)}<RankingLoading title={metric ? activityMetrics[metric].label : 'Рейтинг учасників'} /></>}
    {view === 'members' && <><div className="activity-search"><div className="loading-field"><span>Пошук</span><div className="loading-control"><LoadingValue width="18ch" /></div></div></div><RowsLoading label="Завантаження учасників…" /></>}
    {view === 'member' && <><MemberStatsLoading /><section className="detail-panel"><h3>Найпопулярніші ігри та застосунки</h3><GamesLoading member /></section></>}
    {view === 'game' && <GameContentLoading path={path} period={period} />}
  </section>;
}
