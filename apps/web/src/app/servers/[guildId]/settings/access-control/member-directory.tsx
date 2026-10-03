'use client';

import { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { directoryEventSchema, directoryMemberSchema, type DirectoryEvent, type DirectoryMember } from '@scrt/validation';
import { readMemberSnapshot } from './member-snapshot';
import { applyMemberEvent, reconcileMemberSnapshot } from './member-reconciliation';

type DirectoryMode = 'loading' | 'directory' | 'fallback' | 'error';
type DirectoryState = { members: DirectoryMember[]; mode: DirectoryMode; loaded: number; retry: () => void };
const DirectoryContext = createContext<DirectoryState | null>(null);

export async function directoryJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(response.status === 409 ? 'intent' : 'unavailable');
  return response.json();
}
export function readDirectoryMembers(value: unknown): DirectoryMember[] {
  if (!value || typeof value !== 'object' || !('members' in value) || !Array.isArray(value.members)) throw new Error('Invalid directory response');
  return value.members.map((member: unknown) => directoryMemberSchema.parse(member));
}

export function useMemberDirectory(): DirectoryState {
  const state = useContext(DirectoryContext);
  if (!state) throw new Error('Member directory provider is missing');
  return state;
}

export function MemberDirectoryProvider({ guildId, scope, children }: { guildId: string; scope: 'full' | 'access-roles'; children: ReactNode }) {
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [mode, setMode] = useState<DirectoryMode>('loading');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [loaded, setLoaded] = useState(0);
  const revision = useRef(0);
  const observedRevision = useRef(0);
  const bufferedEvents = useRef<DirectoryEvent[]>([]);
  const roster = useRef(new Map<string, DirectoryMember>());
  const ready = useRef(false);
  const loading = useRef(false);
  const stale = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const lastSnapshot = useRef(0);
  const baseUrl = `/api/guilds/${guildId}/members${scope === 'access-roles' ? '/access-roles' : ''}`;

  const load = useCallback(async () => {
    if (loading.current || !alive.current || document.hidden || !navigator.onLine) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    loading.current = true;
    stale.current = false;
    observedRevision.current = 0;
    bufferedEvents.current = [];
    const abort = new AbortController();
    controller.current = abort;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const all = new Map<string, DirectoryMember>();
      const initial = !ready.current;
      const publish = () => {
        publishTimer = undefined;
        if (!alive.current || abort.signal.aborted || document.hidden) return;
        startTransition(() => { setLoaded(all.size); if (initial) setMembers([...all.values()]); });
      };
      const response = await fetch(`/api/guilds/${guildId}/members/snapshot`, { cache: 'no-store', signal: abort.signal });
      const { startRevision, endRevision } = await readMemberSnapshot(response, (page) => {
        const first = !all.size;
        for (const member of page) all.set(member.id, member);
        if (first) publish();
        else if (!publishTimer) publishTimer = setTimeout(publish, 150);
      });
      if (!alive.current || abort.signal.aborted || controller.current !== abort) return;
      const reconciled = stale.current ? null : reconcileMemberSnapshot(all, startRevision, endRevision, bufferedEvents.current, observedRevision.current);
      if (reconciled === null) throw new Error('Member snapshot changed while loading');
      revision.current = reconciled;
      roster.current = all;
      ready.current = true;
      attempts.current = 0;
      lastSnapshot.current = Date.now();
      startTransition(() => { setMembers([...all.values()]); setLoaded(all.size); });
      setMode('directory');
    } catch (error) {
      if (!alive.current || abort.signal.aborted) return;
      if (error instanceof Error && error.message === 'intent') setMode('fallback');
      else if (++attempts.current <= 3) {
        retryTimer.current = setTimeout(() => { void loadRef.current(); }, 500 * 2 ** attempts.current + Math.random() * 500);
      } else setMode('error');
    } finally {
      if (publishTimer) clearTimeout(publishTimer);
      if (controller.current === abort) { loading.current = false; controller.current = null; }
    }
  }, [guildId]);
  loadRef.current = load;

  useEffect(() => {
    alive.current = true;
    const pause = () => {
      controller.current?.abort();
      controller.current = null;
      loading.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
    const resume = () => {
      if (modeRef.current === 'fallback' || modeRef.current === 'error') return;
      if (!ready.current || lastSnapshot.current === 0) void load();
    };
    const visibility = () => {
      if (document.hidden) {
        // A cancelled partial snapshot must be reconciled when the tab resumes.
        if (loading.current) lastSnapshot.current = 0;
        pause();
      } else resume();
    };
    const offline = () => { if (loading.current) lastSnapshot.current = 0; pause(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', offline);
    window.addEventListener('online', resume);
    void load();
    return () => {
      alive.current = false;
      pause();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', resume);
    };
  }, [load]);

  const disabled = mode === 'fallback' || mode === 'error';
  useEffect(() => {
    if (disabled) return;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;
    let active = true;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let publicationPending = false;
    const publish = () => {
      if (publishTimer) clearTimeout(publishTimer);
      publishTimer = undefined;
      if (!active || document.hidden || loading.current || !publicationPending) return;
      publicationPending = false;
      startTransition(() => { setMembers([...roster.current.values()]); setLoaded(roster.current.size); });
    };
    const onChange = (message: Event) => {
      if (!active || document.hidden || !(message instanceof MessageEvent)) return;
      let parsed: ReturnType<typeof directoryEventSchema.safeParse>;
      try { parsed = directoryEventSchema.safeParse(JSON.parse(message.data)); } catch { return; }
      if (!parsed.success) return;
      const event = parsed.data;
      if (loading.current) {
        observedRevision.current = Math.max(observedRevision.current, event.revision);
        if (event.kind !== 'sync') {
          if (bufferedEvents.current.length < 1000) bufferedEvents.current.push(event);
          else stale.current = true;
        }
        return;
      }
      if (!ready.current) return;
      if (event.kind === 'sync') { if (event.revision !== revision.current) void load(); return; }
      if (event.revision <= revision.current) return;
      if (event.kind === 'reset' || event.revision !== revision.current + 1) { void load(); return; }
      revision.current = event.revision;
      if (event.kind === 'advance') return;
      applyMemberEvent(roster.current, event);
      publicationPending = true;
      if (!publishTimer) publishTimer = setTimeout(publish, 150);
    };
    const disconnect = () => {
      source?.close(); source = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };
    const connect = () => {
      if (!active || document.hidden || !navigator.onLine || source || reconnectTimer) return;
      const events = new EventSource(`${baseUrl}/events`);
      source = events;
      events.onopen = () => { if (source === events) retryDelay = 1000; };
      events.addEventListener('change', (message) => { if (source === events) onChange(message); });
      events.onerror = () => {
        if (!active || source !== events) return;
        disconnect();
        if (document.hidden || !navigator.onLine) return;
        reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect(); }, retryDelay + Math.random() * retryDelay * 0.5);
        retryDelay = Math.min(30_000, retryDelay * 2);
      };
    };
    const visibility = () => {
      if (document.hidden) {
        disconnect();
        if (publishTimer) clearTimeout(publishTimer);
        publishTimer = undefined;
      } else {
        connect();
        publish();
      }
    };
    connect();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', disconnect);
    window.addEventListener('online', connect);
    return () => {
      active = false;
      disconnect();
      if (publishTimer) clearTimeout(publishTimer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('offline', disconnect);
      window.removeEventListener('online', connect);
    };
  }, [baseUrl, disabled, load]);

  useEffect(() => {
    if (mode !== 'directory') return;
    let request: AbortController | null = null;
    const pause = () => { request?.abort(); request = null; };
    const visibility = () => { if (document.hidden) pause(); };
    const timer = window.setInterval(async () => {
      if (document.hidden || !navigator.onLine || loading.current || request) return;
      const abort = new AbortController();
      request = abort;
      try {
        const data = await directoryJson(await fetch(`${baseUrl}?revision=1`, { cache: 'no-store', signal: abort.signal }));
        if (abort.signal.aborted || document.hidden) return;
        if (Date.now() - lastSnapshot.current >= 15 * 60_000 || (data && typeof data === 'object' && 'revision' in data && data.revision !== revision.current)) void load();
      } catch { /* The event stream will reconcile on reconnect. */ }
      finally { if (request === abort) request = null; }
    }, 5 * 60_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', pause);
    return () => {
      window.clearInterval(timer);
      pause();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('offline', pause);
    };
  }, [baseUrl, load, mode]);

  const retry = () => { attempts.current = 0; if (!ready.current) setMode('loading'); void load(); };
  return <DirectoryContext.Provider value={{ members, mode, loaded, retry }}>{children}</DirectoryContext.Provider>;
}
