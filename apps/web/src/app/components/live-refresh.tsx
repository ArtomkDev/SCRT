'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUnsavedChanges } from './unsaved-changes';

function affectsPage(kind: string, pathname: string): boolean {
  if (kind === 'guild' || kind === 'access' || kind === 'guilds' || kind === 'settings') return true;
  const voice = pathname.split('/voice')[1];
  if (voice === undefined) return false;
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
  const { hasChanges } = useUnsavedChanges();
  const dirty = useRef(hasChanges);
  const missedChange = useRef(false);
  dirty.current = hasChanges;
  const path = useRef(pathname);
  path.current = pathname;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!hasChanges && missedChange.current) {
      missedChange.current = false;
      router.refresh();
    }
  }, [hasChanges, router]);

  useEffect(() => {
    let active = true;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let refreshTimer: number | null = null;
    let retryDelay = 1000;
    let lastRefresh = Date.now();
    let synced = false;

    function refreshSoon() {
      if (dirty.current) { missedChange.current = true; return; }
      if (document.hidden || refreshTimer !== null) return;
      const delay = Math.max(400, 1500 - (Date.now() - lastRefresh));
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (!active || document.hidden) return;
        if (dirty.current) { missedChange.current = true; return; }
        lastRefresh = Date.now();
        router.refresh();
      }, delay);
    }

    function disconnect() {
      source?.close();
      source = null;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (active) setConnected(false);
    }

    function connect() {
      if (!active || document.hidden || source) return;
      const events = new EventSource(endpoint);
      source = events;
      events.addEventListener('sync', () => {
        retryDelay = 1000;
        setConnected(true);
        // The page was just rendered on the first connection. Reconcile after a reconnect.
        if (synced) refreshSoon();
        synced = true;
      });
      events.addEventListener('change', (event) => {
        if (affectsPage((event as MessageEvent).data, path.current)) refreshSoon();
      });
      events.onerror = () => {
        disconnect();
        if (!active || document.hidden) return;
        reconnectTimer = window.setTimeout(connect, retryDelay + Math.random() * retryDelay * 0.5);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
    }

    function onVisibilityChange() {
      if (document.hidden) disconnect();
      else connect();
    }

    function onFocus() {
      if (document.hidden) return;
      connect();
      if (Date.now() - lastRefresh > 30_000) refreshSoon();
    }

    connect();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      disconnect();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [endpoint, router]);

  return <span className={`live-status ${connected ? 'live-status-connected' : ''}`} role="status">
    <span aria-hidden="true" />{connected ? 'Автооновлення' : 'Відновлення з’єднання…'}
  </span>;
}
