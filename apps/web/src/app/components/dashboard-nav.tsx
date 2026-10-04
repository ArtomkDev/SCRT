'use client';

import { PrefetchLink } from './prefetch-link';
import { usePathname } from 'next/navigation';
import { ModuleStatusDot, type ModuleState } from './module-status';

export function DashboardNav({ guildId, showVoice = false, showActivity = false, showAccess = false, voiceState, activityState }: { guildId: string; showVoice?: boolean; showActivity?: boolean; showAccess?: boolean; voiceState?: ModuleState; activityState?: ModuleState }) {
  const pathname = usePathname();
  const base = `/servers/${guildId}`;
  const entries: Array<[string, string, ModuleState?]> = [
      ...(showActivity ? [['Активність', `${base}/activity`, activityState] as [string, string, ModuleState?]] : []),
      ...(showVoice ? [['Голосові канали', `${base}/voice`, voiceState] as [string, string, ModuleState?]] : []),
      ...(showAccess ? [['Керування доступом', `${base}/settings/access-control`] as [string, string]] : []),
    ];
  return <nav aria-label="Розділи сервера" className="nav-list">
    {entries.map(([label, href, state]) => <PrefetchLink key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined} className="nav-link"><span>{label}</span>{state && <ModuleStatusDot state={state} label={`${label}: ${state === 'enabled' ? 'увімкнено' : state === 'disabled' ? 'вимкнено' : 'працює частково'}`} />}</PrefetchLink>)}
  </nav>;
}
