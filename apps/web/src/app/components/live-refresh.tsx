'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUnsavedChanges } from './unsaved-changes';

function showsActivityArtwork(pathname: string): boolean {
  return /^\/servers\/[^/]+\/activity(?:\/?$|\/(?:games|members|settings)(?:\/|$))/.test(pathname);
}

function affectsPage(kind: string, pathname: string): boolean {
  if (kind === 'guild' || kind === 'access' || kind === 'guilds' || kind === 'settings') return true;
  if (kind === 'artwork') return showsActivityArtwork(pathname);
  const match = pathname.match(/^\/servers\/[^/]+\/voice(\/.*)?$/);
  if (!match) return false;
  const voice = match[1] ?? '';
  if (voice === '' || voice === '/') return ['rooms', 'creators', 'settings'].includes(kind);
  if (voice.startsWith('/rooms')) return kind === 'rooms';
  if (voice.startsWith('/creators')) return kind === 'creators' || kind === 'rooms';
  if (voice.startsWith('/interfaces')) return kind === 'interfaces' || kind === 'creators';
  if (voice.startsWith('/permissions')) return kind === 'interfaces' || kind === 'creators';
  if (voice.startsWith('/settings')) return kind === 'settings';
  return true;
}

export function LiveRefresh({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const scope = /^\/servers\/[^/]+\/voice(?:\/|$)/.test(pathname) ? 'voice' : showsActivityArtwork(pathname) ? 'activity' : 'guild';
  const scopedEndpoint = /^\/api\/guilds\/[^/]+\/events$/.test(endpoint)
    ? `${endpoint}?scope=${scope}`
    : endpoint;
  const { hasChanges } = useUnsavedChanges();
  const dirty = useRef(hasChanges);
  dirty.current = hasChanges;
  const path = useRef(pathname);
  path.current = pathname;
  const [connected, setConnected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const refreshing = useRef(false);
  const flush = useRef(() => {});

  useEffect(() => {
    refreshing.current = isPending;
    if (!isPending) flush.current();
  }, [hasChanges, isPending]);

  useEffect(() => {
    let active = true;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let stableTimer: number | null = null;
    let refreshTimer: number | null = null;
    let retryDelay = 1000;
    let lastRefresh = Date.now();
    let synced = false;
    let queued = false;
    let refreshVersion = 0;

    function flushRefresh() {
      if (!active || !queued || dirty.current || refreshing.current || document.hidden || !navigator.onLine || refreshTimer !== null) return;
      const delay = Math.max(400, 1500 - (Date.now() - lastRefresh));
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!active || document.hidden || !navigator.onLine || dirty.current || refreshing.current) return;
        queued = false;
        refreshing.current = true;
        lastRefresh = Date.now();
        refreshVersion++;
        // Keep revealed content interactive while the new server payload streams in.
        startTransition(() => router.refresh());
      }, delay);
    }
    flush.current = flushRefresh;

    function refreshSoon() {
      queued = true;
      flushRefresh();
    }

    function disconnect() {
      source?.close();
      source = null;
      if (stableTimer !== null) window.clearTimeout(stableTimer);
      stableTimer = null;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (active) setConnected(false);
    }

    function connect() {
      if (!active || document.hidden || !navigator.onLine || source || reconnectTimer !== null) return;
      const events = new EventSource(scopedEndpoint);
      source = events;
      const versionAtConnect = refreshVersion;
      events.addEventListener('sync', () => {
        if (!active || source !== events) return;
        // A stream that syncs and immediately fails must retain exponential backoff.
        if (stableTimer === null) stableTimer = window.setTimeout(() => { stableTimer = null; retryDelay = 1000; }, 30_000);
        setConnected(true);
        // A focus/visibility refresh may already have reconciled this connection.
        if (synced && versionAtConnect === refreshVersion) refreshSoon();
        synced = true;
      });
      events.addEventListener('change', (event) => {
        if (!active || source !== events) return;
        if (affectsPage((event as MessageEvent).data, path.current)) refreshSoon();
      });
      const reconnect = () => {
        if (!active || source !== events) return;
        disconnect();
        if (document.hidden || !navigator.onLine) return;
        reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connect(); }, retryDelay + Math.random() * retryDelay * 0.5);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
      events.onerror = reconnect;
      events.addEventListener('fault', reconnect);
    }

    function pause() {
      disconnect();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    function resume() {
      if (document.hidden || !navigator.onLine) return;
      // Do not wait for all database subscriptions to sync before showing fresh data.
      refreshSoon();
      connect();
    }

    function onVisibilityChange() {
      if (document.hidden) pause();
      else resume();
    }

    function onFocus() {
      if (document.hidden) return;
      connect();
      if (Date.now() - lastRefresh > 30_000) refreshSoon();
      else flushRefresh();
    }

    connect();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('offline', pause);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', onPageShow);
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) resume(); }
    return () => {
      active = false;
      pause();
      flush.current = () => {};
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('offline', pause);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [scopedEndpoint, router, startTransition]);

  return <span className={`live-status ${connected ? 'live-status-connected' : ''}`} role="status" aria-busy={isPending}>
    <span aria-hidden="true" />{isPending ? 'Оновлення даних…' : connected ? 'Автооновлення' : 'Відновлення з’єднання…'}
  </span>;
}
