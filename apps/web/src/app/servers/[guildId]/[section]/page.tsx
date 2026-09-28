import { notFound } from 'next/navigation';
import { requireGuildAccess } from '@/lib/guards';
import type { AppPermission } from '@scrt/permissions';

const sections: Record<string, { title: string; permission: AppPermission }> = { members: { title: 'Members', permission: 'members.view' }, activity: { title: 'Activity', permission: 'activity.view' }, voice: { title: 'Voice', permission: 'voice.view' }, moderation: { title: 'Moderation', permission: 'moderation.view' }, automation: { title: 'Automation', permission: 'automation.view' }, logs: { title: 'Logs', permission: 'logs.view' }, settings: { title: 'Settings', permission: 'settings.view' } };
export default async function Section({ params }: { params: Promise<{ guildId: string; section: string }> }) { const { guildId, section } = await params; const config = sections[section]; if (!config) notFound(); await requireGuildAccess(guildId, config.permission); return <><h2 className="text-3xl font-semibold">{config.title}</h2><p className="mt-4 text-slate-400">No {config.title.toLowerCase()} data yet. This module is planned.</p></>; }
