import { Suspense, type ReactNode } from 'react';
import { requireGuildAccess } from '@/lib/guards';
import { GuildIcon } from '../../components/guild-icon';
import { DashboardNav } from '../../components/dashboard-nav';
import { LiveRefresh } from '../../components/live-refresh';
import { voiceSettings } from '@/lib/voice-data';
import { activitySettings } from '@/lib/activity-data';
import { LoadingValue } from '../../components/data-loading';
import { DataBoundary } from '../../components/data-boundary';
import { initialMediaSnapshot } from '@/lib/media-data';

async function ModuleNavigation({ guildId, userId, showVoice, showActivity, showMedia, showAccess }: { guildId: string; userId: string; showVoice: boolean; showActivity: boolean; showMedia: boolean; showAccess: boolean }) {
  const [voice, activity, media] = await Promise.all([showVoice ? voiceSettings(guildId) : null, showActivity ? activitySettings(guildId) : null, showMedia ? initialMediaSnapshot(guildId, userId) : null]);
  return <DashboardNav guildId={guildId} showVoice={showVoice} showActivity={showActivity} showMedia={showMedia} showAccess={showAccess} voiceState={voice ? voice.enabled ? 'enabled' : 'disabled' : undefined} activityState={activity ? activity.enabled ? 'enabled' : 'disabled' : undefined} mediaState={media ? !media.snapshot.settings.enabled ? 'disabled' : media.unavailable || !media.snapshot.engine.available || media.snapshot.session?.lastError ? 'degraded' : 'enabled' : undefined} />;
}

async function GuildSidebar({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { discordGuild, permissions, user } = await requireGuildAccess(guildId);
  const navigation = { guildId, userId: user.id, showVoice: permissions.has('voice.view'), showActivity: permissions.has('activity.view'), showMedia: permissions.has('media.view'), showAccess: permissions.has('settings.view') };
  return <aside className="guild-sidebar"><div className="guild-context"><GuildIcon id={guildId} name={discordGuild.name} icon={discordGuild.icon} size={32} /><span className="guild-context-name">{discordGuild.name}</span></div><span className="sidebar-label">Сервер</span><DataBoundary title="Статус модулів недоступний" compact fallback={<DashboardNav {...navigation} />}><Suspense fallback={<DashboardNav {...navigation} />}><ModuleNavigation {...navigation} /></Suspense></DataBoundary><LiveRefresh endpoint={`/api/guilds/${guildId}/events`} /></aside>;
}

export default function GuildLayout(props: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  return <div className="guild-workspace"><DataBoundary title="Меню сервера недоступне" className="guild-sidebar" fallback={<><span className="sidebar-label">Сервер</span><a href="/servers">Усі сервери</a></>}><Suspense fallback={<aside className="guild-sidebar" aria-label="Завантаження сервера…" aria-busy="true"><div className="guild-context"><span className="guild-icon" style={{ width: 32, height: 32 }} aria-hidden="true" /><span className="guild-context-name"><LoadingValue width="14ch" /></span></div><span className="sidebar-label">Сервер</span></aside>}><GuildSidebar params={props.params} /></Suspense></DataBoundary><div className="guild-content">{props.children}</div></div>;
}
