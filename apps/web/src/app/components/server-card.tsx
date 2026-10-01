import { PrefetchLink } from './prefetch-link';
import { guildAction, type ManageableGuild } from '@/lib/guild-presentation';
import { GuildIcon } from './guild-icon';

export function ServerCard({ guild }: { guild: ManageableGuild }) {
  const action = guildAction(guild);
  return <article className="server-card">
    <GuildIcon id={guild.id} name={guild.name} icon={guild.icon} size={48} />
    <div className="server-card-copy"><h3>{guild.name}</h3><p>{guild.installed ? 'SCRT підключено' : 'SCRT ще не додано'}</p></div>
    {guild.installed
      ? <PrefetchLink className="action-link" href={action.href}>{action.label}</PrefetchLink>
      : <a className="action-link" href={action.href}>{action.label}</a>}
  </article>;
}
