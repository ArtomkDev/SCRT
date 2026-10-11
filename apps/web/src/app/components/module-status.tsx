import { Panel } from '@/app/components/dashboard-screen';
import type { ReactNode } from 'react';

export type ModuleState = 'enabled' | 'disabled' | 'degraded';

const labels: Record<ModuleState | 'unknown', string> = {
  enabled: 'Модуль увімкнено',
  disabled: 'Модуль вимкнено',
  degraded: 'Модуль працює частково',
  unknown: 'Статус уточнюється',
};

export function ModuleStatusDot({ state = 'unknown', label = labels[state] }: { state?: ModuleState | 'unknown'; label?: string }) {
  return <span className={`module-status-dot module-status-${state}`} role="img" aria-label={label} title={label} />;
}

export function ModuleStatus({ state = 'unknown' }: { state?: ModuleState | 'unknown' }) {
  return <span className="module-status" aria-busy={state === 'unknown'}><ModuleStatusDot state={state} /><span>{labels[state]}</span></span>;
}

export function ModuleDisabledState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <Panel className="module-state-panel" aria-label={title}>
    <ModuleStatus state="disabled" />
    <h2>{title}</h2>
    <p>{description}</p>
    {children && <div className="module-state-actions">{children}</div>}
  </Panel>;
}
