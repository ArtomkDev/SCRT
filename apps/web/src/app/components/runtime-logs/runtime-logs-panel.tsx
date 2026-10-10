'use client';
import { createContext, useContext, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { RuntimeLogs } from './runtime-logs';
import './runtime-logs.css';

type PanelState = { open: boolean; visited: boolean; id: string; trigger: RefObject<HTMLButtonElement | null>; toggle: () => void; close: () => void };
const PanelContext = createContext<PanelState | null>(null);
function usePanel() {
  const value = useContext(PanelContext);
  if (!value) throw new Error('Runtime logs require the dashboard shell');
  return value;
}
export function RuntimeLogsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const toggle = () => { setVisited(true); setOpen((value) => !value); };
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <PanelContext.Provider value={{ open, visited, id, trigger, toggle, close }}>{children}</PanelContext.Provider>;
}
export function RuntimeLogsButton() {
  const { open, id, trigger, toggle } = usePanel();
  return <button ref={trigger} type="button" className="logout runtime-logs-toggle" aria-expanded={open} aria-controls={id} onClick={toggle}>Логи</button>;
}
export function RuntimeLogsWorkspace({ children }: { children: ReactNode }) {
  const { open, visited, id, close } = usePanel();
  return <div className="runtime-logs-workspace" data-logs-open={open}>
    <div className="runtime-logs-main">{children}</div>
    <aside id={id} className="runtime-logs-dock" aria-label="Логи поточного запуску" aria-hidden={!open} inert={!open} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="runtime-logs-panel">
        <header className="runtime-logs-panel-header"><div><span className="sidebar-label">Діагностика SCRT</span><h2>Логи запуску</h2></div><button type="button" className="runtime-logs-close" aria-label="Закрити логи" onClick={close}>×</button></header>
        <div className="runtime-logs-panel-body">{visited && <RuntimeLogs active={open} />}</div>
      </div>
    </aside>
  </div>;
}
