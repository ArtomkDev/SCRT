'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ModuleStatus, type ModuleState } from './module-status';

export type GuildModule = 'voice' | 'activity' | 'media';
type States = Partial<Record<GuildModule, ModuleState>>;
type StatusContext = { guildId: string; states: States; publish: (module: GuildModule, state: ModuleState) => void };
const Context = createContext<StatusContext | null>(null);
const emptyStates: States = {};

// Scoped to one server layout: never retain another guild's status on navigation.
export function GuildModuleStatusProvider({ guildId, children }: { guildId: string; children: ReactNode }) {
  const [stored, setStored] = useState({ guildId, states: emptyStates });
  const states = stored.guildId === guildId ? stored.states : emptyStates;
  const publish = useCallback((module: GuildModule, state: ModuleState) => {
    setStored((previous) => previous.guildId === guildId && previous.states[module] === state ? previous : { guildId, states: { ...(previous.guildId === guildId ? previous.states : emptyStates), [module]: state } });
  }, [guildId]);
  const value = useMemo(() => ({ guildId, states, publish }), [guildId, states, publish]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useGuildModuleState(guildId: string, module: GuildModule, state?: ModuleState) {
  const context = useContext(Context);
  const scoped = context?.guildId === guildId ? context : null;
  const publish = scoped?.publish;
  useEffect(() => { if (state) publish?.(module, state); }, [publish, module, state]);
  return scoped?.states[module] ?? state;
}

export function GuildModuleStatus({ guildId, module, state }: { guildId: string; module: GuildModule; state?: ModuleState }) {
  const known = useGuildModuleState(guildId, module, state);
  return <ModuleStatus state={state ?? known} />;
}
