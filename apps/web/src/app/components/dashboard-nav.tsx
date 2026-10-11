'use client';

import { PrefetchLink } from './prefetch-link';
import { usePathname } from 'next/navigation';
import { ModuleStatusDot, type ModuleState } from './module-status';
import { useGuildModuleState } from './guild-module-status';

export function DashboardNav({ guildId, showVoice = false, showActivity = false, showMedia = false, showAccess = false, voiceState, activityState, mediaState }: { guildId: string; showVoice?: boolean; showActivity?: boolean; showMedia?: boolean; showAccess?: boolean; voiceState?: ModuleState; activityState?: ModuleState; mediaState?: ModuleState }) {
  const pathname = usePathname();
  const base = `/servers/${guildId}`;
  const voice = useGuildModuleState(guildId, 'voice', showVoice ? voiceState : undefined);
  const activity = useGuildModuleState(guildId, 'activity', showActivity ? activityState : undefined);
  const media = useGuildModuleState(guildId, 'media', showMedia ? mediaState : undefined);
  const entries: Array<[string, string, ModuleState?]> = [
      ...(showVoice ? [['Голосові канали', `${base}/voice`, voice] as [string, string, ModuleState?]] : []),
      ...(showActivity ? [['Активність', `${base}/activity`, activity] as [string, string, ModuleState?]] : []),
      ...(showMedia ? [['Медіа', `${base}/media`, media] as [string, string, ModuleState?]] : []),
      ...(showAccess ? [['Керування доступом', `${base}/settings/access-control`] as [string, string]] : []),
    ];
  return <nav aria-label="Розділи сервера" className="nav-list">
    {entries.map(([label, href, state]) => <PrefetchLink key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined} className="nav-link"><span>{label}</span>{href !== `${base}/settings/access-control` && <ModuleStatusDot state={state} label={`${label}: ${state === 'enabled' ? 'увімкнено' : state === 'disabled' ? 'вимкнено' : state === 'degraded' ? 'працює частково' : 'статус уточнюється'}`} />}</PrefetchLink>)}
  </nav>;
}
