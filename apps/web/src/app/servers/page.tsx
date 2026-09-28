import { manageableGuilds } from '@/lib/guards';
import { guilds } from '@/lib/server';
import { groupGuilds } from '@/lib/guild-presentation';
import { ServerCard } from '../components/server-card';

export default async function Servers() {
  const list = await manageableGuilds();
  const installedIds = await guilds().installedGuildIds(list.map((guild) => guild.id));
  const groups = groupGuilds(list, installedIds);
  return <main className="content-page"><div className="page-heading"><h1>Сервери</h1><p>Керуйте SCRT на своїх Discord-серверах.</p></div>
    <section className="server-group" aria-labelledby="installed-heading"><div className="section-heading"><h2 id="installed-heading">Підключені сервери</h2><span>{groups.installed.length}</span></div>{groups.installed.length ? <div className="server-grid">{groups.installed.map((guild) => <ServerCard key={guild.id} guild={guild} />)}</div> : <p className="empty-state">Поки немає підключених серверів.</p>}</section>
    <section className="server-group" aria-labelledby="available-heading"><div className="section-heading"><h2 id="available-heading">Доступні для підключення</h2><span>{groups.available.length}</span></div>{groups.available.length ? <div className="server-grid">{groups.available.map((guild) => <ServerCard key={guild.id} guild={guild} />)}</div> : <p className="empty-state">{list.length ? 'SCRT уже додано до всіх доступних серверів.' : 'У вас немає серверів, якими можна керувати.'}</p>}</section>
  </main>;
}
