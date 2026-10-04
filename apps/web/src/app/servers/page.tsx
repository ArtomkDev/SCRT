import { manageableGuildList } from '@/lib/guards';
import { Suspense } from 'react';
import { ServerGroupsLoading } from './loading-content';
import { groupGuilds } from '@/lib/guild-presentation';
import { ServerCard } from '../components/server-card';
import { LiveRefresh } from '../components/live-refresh';
import { DataBoundary } from '../components/data-boundary';

async function ServerGroups() {
  const { list, installedIds } = await manageableGuildList();
  const groups = groupGuilds(list, installedIds);
  return <><LiveRefresh endpoint="/api/servers/events" />
    <section className="server-group" aria-labelledby="installed-heading"><div className="section-heading"><h2 id="installed-heading">Підключені сервери</h2><span>{groups.installed.length}</span></div>{groups.installed.length ? <div className="server-grid">{groups.installed.map((guild) => <ServerCard key={guild.id} guild={guild} />)}</div> : <p className="empty-state">Немає підключених серверів.</p>}</section>
    <section className="server-group" aria-labelledby="available-heading"><div className="section-heading"><h2 id="available-heading">Доступні для підключення</h2><span>{groups.available.length}</span></div>{groups.available.length ? <div className="server-grid">{groups.available.map((guild) => <ServerCard key={guild.id} guild={guild} />)}</div> : <p className="empty-state">{list.length ? 'SCRT уже додано до всіх доступних серверів.' : 'У вас немає серверів, якими можна керувати.'}</p>}</section>
  </>;
}

export default async function Servers({ searchParams }: { searchParams: Promise<{ install?: string }> }) {
  const install = (await searchParams).install;
  return <main className="content-page"><div className="page-heading"><h1>Сервери</h1><p>Виберіть сервер для налаштування SCRT.</p></div>
    {install === 'failed' && <p className="form-feedback form-feedback-error" role="alert">Не вдалося завершити встановлення. Якщо бот уже на сервері, зверніться до власника, щоб отримати доступ до панелі.</p>}
    {install === 'denied' && <p className="form-feedback" role="status">Встановлення бота скасовано.</p>}
    <DataBoundary title="Список серверів не завантажився"><Suspense fallback={<ServerGroupsLoading />}><ServerGroups /></Suspense></DataBoundary>
  </main>;
}
