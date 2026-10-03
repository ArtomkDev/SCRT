import type { ReactNode } from 'react';

export type ModuleState = 'enabled' | 'disabled' | 'degraded';

const labels: Record<ModuleState, string> = {
  enabled: 'Модуль увімкнено',
  disabled: 'Модуль вимкнено',
  degraded: 'Модуль працює частково',
};

export function ModuleStatusDot({ state, label = labels[state] }: { state: ModuleState; label?: string }) {
  return <span className={`module-status-dot module-status-${state}`} role="img" aria-label={label} title={label} />;
}

export function ModuleStatus({ state }: { state: ModuleState }) {
  return <span className="module-status"><ModuleStatusDot state={state} /><span>{labels[state]}</span></span>;
}

export function ModuleDisabledState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <section className="module-state-panel" aria-label={title}>
    <ModuleStatus state="disabled" />
    <h2>{title}</h2>
    <p>{description}</p>
    {children && <div className="module-state-actions">{children}</div>}
  </section>;
}
