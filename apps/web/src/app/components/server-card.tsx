import Link from 'next/link';
import { guildAction, type ManageableGuild } from '@/lib/guild-presentation';
import { env } from '@/lib/server';
import { GuildIcon } from './guild-icon';

export function ServerCard({ guild }: { guild: ManageableGuild }) {
  const action = guildAction(guild, env().DISCORD_CLIENT_ID);
  return <article className="server-card">
    <GuildIcon id={guild.id} name={guild.name} icon={guild.icon} size={48} />
    <div className="server-card-copy"><h3>{guild.name}</h3><p>{guild.installed ? 'SCRT підключено' : 'SCRT ще не додано'}</p></div>
    {guild.installed
      ? <Link className="action-link" href={action.href} prefetch={false}>{action.label}</Link>
      : <a className="action-link" href={action.href} target="_blank" rel="noopener noreferrer">{action.label}</a>}
  </article>;
}
