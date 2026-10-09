'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaCommandResultSchema, mediaSnapshotSchema, type MediaAction, type MediaSnapshot } from '@scrt/validation';
import type { MediaTrack } from '@scrt/shared';

type PendingCommand = { id: string; action: MediaAction; track?: MediaTrack; at: number };
export async function mediaResponse(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(typeof value === 'object' && value && 'error' in value ? String(value.error) : 'Медіа недоступне.');
  return value;
}
function project(snapshot: MediaSnapshot, commands: PendingCommand[]): MediaSnapshot {
  const next = structuredClone(snapshot); const session = next.session;
  if (!session) return next;
  for (const { action, at } of commands) {
    switch (action.type) {
      case 'PAUSE': session.state = 'paused'; session.pausedAt = at; break;
      case 'RESUME': session.state = 'playing'; session.accumulatedPauseMs += Math.max(0, at - (session.pausedAt ?? at)); session.pausedAt = null; break;
      case 'SET_VOLUME': session.volume = action.volume; break;
      case 'SET_REPEAT': session.repeatMode = action.repeatMode; break;
      case 'SET_SHUFFLE': session.shuffle = action.shuffle; break;
      case 'SET_LOCK': session.lockedMode = action.lockedMode; break;
      case 'REMOVE_QUEUE_ITEM': session.queue = session.queue.filter((item) => item.queueItemId !== action.queueItemId); session.played = session.played.filter((item) => item.queueItemId !== action.queueItemId); break;
      case 'MOVE_QUEUE_ITEM': {
        const from = session.queue.findIndex((item) => item.queueItemId === action.queueItemId);
        if (from !== -1) { const [item] = session.queue.splice(from, 1); session.queue.splice(Math.min(action.position, session.queue.length), 0, item!); }
        break;
      }
      case 'SKIP': case 'STOP': {
        const current = session.currentTrack;
        if (current) session.played = [...session.played.filter((item) => item.provider !== current.provider || item.providerItemId !== current.providerItemId), current].slice(-100);
        session.currentTrack = action.type === 'SKIP' ? session.queue.shift() ?? null : null;
        session.played = session.played.filter((item) => item.provider !== session.currentTrack?.provider || item.providerItemId !== session.currentTrack?.providerItemId);
        session.state = session.currentTrack ? 'buffering' : 'idle'; session.recoverable = action.type === 'STOP' && session.queue.length > 0; session.startedAt = null; session.pausedAt = null; break;
      }
    }
  }
  return next;
}

// One ordered command stream: clicks update the UI immediately and use the latest
// acknowledged session/version when dispatched. They never bypass worker policy.
export function useMediaController(guildId: string, initial: MediaSnapshot, initialError: string | null) {
  const endpoint = `/api/guilds/${guildId}/media`;
  const confirmed = useRef(initial); const jobs = useRef<PendingCommand[]>([]);
  const running = useRef(false); const epoch = useRef(0); const disposed = useRef(false);
  const [view, setView] = useState({ snapshot: initial, pending: [] as PendingCommand[] });
  const [unavailable, setUnavailable] = useState(initialError);
  const [feedback, setFeedback] = useState({ message: '', transient: false });
  const setMessage = useCallback((message: string) => setFeedback({ message, transient: false }), []);
  useEffect(() => {
    if (!feedback.transient || !feedback.message) return;
    const timer = setTimeout(() => setFeedback((current) => current === feedback ? { message: '', transient: false } : current), 3200);
    return () => clearTimeout(timer);
  }, [feedback]);
  const publish = useCallback(() => { if (!disposed.current) setView({ snapshot: project(confirmed.current, jobs.current), pending: [...jobs.current] }); }, []);
  const readSnapshot = useCallback(async (signal?: AbortSignal) => {
    const value = mediaSnapshotSchema.parse(await mediaResponse(await fetch(endpoint, { cache: 'no-store', signal })));
    if (value.session && value.session.guildId !== guildId) throw new Error('Некоректний стан сервера.');
    return value;
  }, [endpoint, guildId]);
  const sync = useCallback(async (signal?: AbortSignal) => {
    if (running.current || jobs.current.length) return;
    const before = epoch.current;
    try {
      const value = await readSnapshot(signal);
      if (!disposed.current && !signal?.aborted && before === epoch.current && !running.current) { confirmed.current = value; setUnavailable(null); publish(); }
    } catch (error) {
      if (!disposed.current && !signal?.aborted && before === epoch.current && !running.current) setUnavailable(error instanceof Error ? error.message : 'З’єднання перервано.');
    }
  }, [readSnapshot, publish]);
  useEffect(() => {
    disposed.current = false; const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed.current) return;
      if (!document.hidden) await sync(abort.signal);
      if (!disposed.current) timer = setTimeout(() => { void poll(); }, 5000);
    };
    void poll();
    return () => { disposed.current = true; jobs.current = []; clearTimeout(timer); abort.abort(); };
  }, [sync]);

  async function drain() {
    if (running.current) return;
    running.current = true;
    try {
      while (jobs.current.length && !disposed.current) {
        const job = jobs.current[0]!; const session = confirmed.current.session;
        const action = 'expectedQueueVersion' in job.action ? { ...job.action, expectedQueueVersion: session?.queueVersion ?? 0 } : job.action;
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: job.id, sessionId: session?.sessionId ?? null, expectedQueueVersion: session?.queueVersion ?? null, action }) });
          const result = mediaCommandResultSchema.parse(await mediaResponse(response));
          if (result.snapshot.session && result.snapshot.session.guildId !== guildId) throw new Error('Некоректний стан сервера.');
          confirmed.current = result.snapshot; jobs.current.shift();
          if (!disposed.current) {
            setUnavailable(null);
            const recovery = action.type === 'ADD_TRACK' && Boolean(result.snapshot.session?.recoverable);
            setFeedback({ message: action.type === 'ADD_TRACK' ? recovery ? 'Трек додано до збереженої черги. Натисніть «Відновити», щоб запустити сесію.' : 'Трек додано до черги.' : action.type === 'VOTE_SKIP' ? 'Голос враховано.' : '', transient: !recovery });
            publish();
          }
        } catch (error) {
          // A timeout may already have applied: do not retry or execute later clicks
          // against an unknown state. Reconcile once and expose the failure.
          const cancelled = jobs.current.length > 1; jobs.current = []; epoch.current++;
          if (!disposed.current) setMessage(`${error instanceof Error ? error.message : 'Не вдалося виконати дію.'}${cancelled ? ' Наступні дії скасовано.' : ''}`);
          publish();
          try {
            confirmed.current = await readSnapshot();
            if (!disposed.current) { setUnavailable(null); publish(); }
          } catch {
            jobs.current = []; publish();
            if (!disposed.current) setUnavailable('Не вдалося оновити стан плеєра.');
          }
          // Keep the command stream locked throughout reconciliation. New clicks
          // can queue up, but only run against the newly confirmed state.
        }
      }
    } finally { running.current = false; }
  }
  function send(action: MediaAction, track?: MediaTrack) {
    if (disposed.current) return;
    if (jobs.current.length >= 20) { setMessage('Забагато дій поспіль. Дочекайтеся синхронізації.'); return; }
    if ((action.type === 'ADD_TRACK' || action.type === 'PLAY_TRACK') && jobs.current.some((job) => job.action.type === action.type && 'providerItemId' in job.action && job.action.provider === action.provider && job.action.providerItemId === action.providerItemId)) return;
    const last = jobs.current.at(-1);
    if (action.type === 'SET_VOLUME' && last?.action.type === 'SET_VOLUME' && (!running.current || jobs.current.length > 1)) last.action = action;
    else jobs.current.push({ id: crypto.randomUUID(), action, track, at: Date.now() });
    epoch.current++; setMessage(''); publish(); void drain();
  }
  return { ...view, unavailable, ...feedback, setMessage, send };
}
