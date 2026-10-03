import { Suspense, type ReactNode } from 'react';
import { requireGuildAccess } from '@/lib/guards';
import { GuildIcon } from '../../components/guild-icon';
import { DashboardNav } from '../../components/dashboard-nav';
import { LiveRefresh } from '../../components/live-refresh';
import { voiceSettings } from '@/lib/voice-data';
import { activitySettings } from '@/lib/activity-data';

async function ModuleNavigation({ guildId, showVoice, showActivity, showAccess }: { guildId: string; showVoice: boolean; showActivity: boolean; showAccess: boolean }) {
  const [voice, activity] = await Promise.all([showVoice ? voiceSettings(guildId) : null, showActivity ? activitySettings(guildId) : null]);
  return <DashboardNav guildId={guildId} showVoice={showVoice} showActivity={showActivity} showAccess={showAccess} voiceState={voice ? voice.enabled ? 'enabled' : 'disabled' : undefined} activityState={activity ? activity.enabled ? 'enabled' : 'disabled' : undefined} />;
}

async function GuildSidebar({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { discordGuild, permissions } = await requireGuildAccess(guildId);
  const navigation = { guildId, showVoice: permissions.has('voice.view'), showActivity: permissions.has('activity.view'), showAccess: permissions.has('settings.view') };
  return <aside className="guild-sidebar"><div className="guild-context"><GuildIcon id={guildId} name={discordGuild.name} icon={discordGuild.icon} size={32} /><span className="guild-context-name">{discordGuild.name}</span></div><span className="sidebar-label">Сервер</span><Suspense fallback={<DashboardNav {...navigation} />}><ModuleNavigation {...navigation} /></Suspense><LiveRefresh endpoint={`/api/guilds/${guildId}/events`} /></aside>;
}

export default function GuildLayout(props: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  return <div className="guild-workspace"><Suspense fallback={<aside className="guild-sidebar" aria-busy="true"><p className="muted" role="status">Завантаження сервера…</p><div className="skeleton skeleton-card" aria-hidden="true" /></aside>}><GuildSidebar params={props.params} /></Suspense><div className="guild-content">{props.children}</div></div>;
}
