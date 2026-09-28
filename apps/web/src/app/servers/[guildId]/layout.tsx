import type { ReactNode } from 'react';
import { requireGuildAccess } from '@/lib/guards';
import { GuildIcon } from '../../components/guild-icon';
import { DashboardNav } from '../../components/dashboard-nav';

export default async function GuildLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { discordGuild } = await requireGuildAccess(guildId);
  return <div className="guild-workspace"><aside className="guild-sidebar"><div className="guild-context"><GuildIcon id={guildId} name={discordGuild.name} icon={discordGuild.icon} size={40} /><span className="guild-context-name">{discordGuild.name}</span></div><DashboardNav guildId={guildId} /></aside><div className="guild-content">{children}</div></div>;
}
