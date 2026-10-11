import { manageableGuildList } from '@/lib/guards';
import { Suspense } from 'react';
import { ServerGroupsLoading } from './loading-content';
import { groupGuilds } from '@/lib/guild-presentation';
import { ServerCard } from '../components/server-card';
import { LiveRefresh } from '../components/live-refresh';
import { DataBoundary } from '../components/data-boundary';
import { DashboardScreen, PanelHeader, ScreenHeader } from '../components/dashboard-screen';

async function ServerGroups() {
  const { list, installedIds } = await manageableGuildList();
  const groups = groupGuilds(list, installedIds);
  return <><LiveRefresh endpoint="/api/servers/events" />
    <section className="server-group" aria-label="Підключені сервери"><PanelHeader className="section-heading" title="Підключені сервери" actions={<span>{groups.installed.length}</span>} />{groups.installed.length ? <div className="server-grid">{groups.installed.map((guild) => <ServerCard key={guild.id} guild={guild} />)}</div> : <p className="empty-state">Немає підключених серверів.</p>}</section>
    <section className="server-group" aria-label="Доступні для підключення"><PanelHeader className="section-heading" title="Доступні для підключення" actions={<span>{groups.available.length}</span>} />{groups.available.length ? <div className="server-grid">{groups.available.map((guild) => <ServerCard key={guild.id} guild={guild} />)}</div> : <p className="empty-state">{list.length ? 'SCRT уже додано до всіх доступних серверів.' : 'У вас немає серверів, якими можна керувати.'}</p>}</section>
  </>;
}

export default async function Servers({ searchParams }: { searchParams: Promise<{ install?: string }> }) {
  const install = (await searchParams).install;
  return <DashboardScreen header={<ScreenHeader title="Сервери" description="Виберіть сервер для налаштування SCRT." />}>
    {install === 'failed' && <p className="form-feedback form-feedback-error" role="alert">Не вдалося завершити встановлення. Якщо бот уже на сервері, зверніться до власника, щоб отримати доступ до панелі.</p>}
    {install === 'denied' && <p className="form-feedback" role="status">Встановлення бота скасовано.</p>}
    <DataBoundary title="Список серверів не завантажився"><Suspense fallback={<ServerGroupsLoading />}><ServerGroups /></Suspense></DataBoundary>
  </DashboardScreen>;
}
