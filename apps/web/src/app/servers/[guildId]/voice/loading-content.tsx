import { LoadingValue, MetricsLoading, SettingsLoading, TableLoading } from '@/app/components/data-loading';

export const roomColumns = ['Кімната', 'Власник', 'Канал створення', 'Учасники', 'Стан', 'Оновлено', 'Дії'];
export const permissionNames = ['Перегляд каналів', 'Керування каналами', 'Керування ролями', 'Переміщення учасників', 'Підключення', 'Надсилання повідомлень', 'Вбудовування посилань', 'Історія повідомлень'];

export function VoiceSettingsLoading() {
  return <SettingsLoading title="Налаштування модуля" label="Завантаження налаштувань голосового модуля…" sections={[
    { title: 'Робота модуля', fields: ['Створювати голосові кімнати'], control: 'switch' },
    { title: 'Видалення та зміна власника', fields: ['Видалити порожню кімнату через', 'Час на повернення власника', 'Якщо власник не повернувся', 'Повторний вхід у канал створення', 'Кімнат на одного учасника'] },
    { title: 'Панель і журнал', fields: ['Панель за замовчуванням', 'Канал журналу'] },
    { title: 'Вхід без обмежень', fields: ['Ролі'] },
  ]} />;
}

export function VoicePageLoading({ view = 'overview' }: { view?: 'overview' | 'rooms' | 'creators' | 'interfaces' | 'permissions' }) {
  const title = { overview: 'Огляд', rooms: 'Активні кімнати', creators: 'Канали створення', interfaces: 'Панелі керування', permissions: 'Дозволи SCRT' }[view];
  return <section className={view === 'creators' ? 'creators-page' : undefined} aria-label="Завантаження голосового модуля…" aria-busy="true"><h2 className="subheading">{title}</h2>
    {view === 'overview' && <MetricsLoading labels={['Канали створення', 'Активні кімнати']} className="voice-module-summary" label="Завантаження стану голосового модуля…" />}
    {view === 'rooms' && <TableLoading columns={roomColumns} label="Завантаження кімнат…" className="voice-table" wrapperClassName="voice-table-wrap" />}
    {(view === 'creators' || view === 'interfaces') && <div className="voice-item"><h3><LoadingValue width="18ch" /></h3><p><LoadingValue width="24ch" /></p></div>}
    {view === 'permissions' && <section className="voice-item"><h3>Дозволи ролі бота</h3><ul className="voice-permission-list">{permissionNames.map((name) => <li key={name}><LoadingValue width="2ch" /> {name}</li>)}</ul></section>}
  </section>;
}
