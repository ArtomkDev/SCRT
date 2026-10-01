import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { requireGuildAccess } from '@/lib/guards';
import { GuildIcon } from '../../components/guild-icon';
import { DashboardNav } from '../../components/dashboard-nav';
import { LiveRefresh } from '../../components/live-refresh';

async function GuildWorkspace({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { discordGuild, permissions } = await requireGuildAccess(guildId);
  return <div className="guild-workspace"><aside className="guild-sidebar"><Link href="/servers" className="back-link">← Усі сервери</Link><div className="guild-context"><GuildIcon id={guildId} name={discordGuild.name} icon={discordGuild.icon} size={40} /><span className="guild-context-name">{discordGuild.name}</span></div><span className="sidebar-label">Налаштування сервера</span><DashboardNav guildId={guildId} showVoice={permissions.has('voice.view')} showAccess={permissions.has('settings.view')} /><LiveRefresh endpoint={`/api/guilds/${guildId}/events`} /></aside><div className="guild-content">{children}</div></div>;
}

export default function GuildLayout(props: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  return <Suspense fallback={<div className="content-page" role="status" aria-busy="true"><p className="muted">Завантаження сервера…</p></div>}><GuildWorkspace {...props} /></Suspense>;
}
