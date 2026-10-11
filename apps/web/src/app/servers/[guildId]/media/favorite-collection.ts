'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mediaResponse } from './player-controller';

type Favorite = { id: string; likedBy: Array<{ userId: string; name: string; likedAt: number }> };
export function useFavoriteCollection<T extends Favorite, Entity>({ endpoint, userId, enabled = true, pageSchema, itemSchema, entity, identity, payload }: {
  endpoint: string; userId: string; enabled?: boolean;
  pageSchema: { parse(value: unknown): { items: T[]; next: string | null } };
  itemSchema: { parse(value: unknown): { item: T | null } };
  entity: (item: T) => Entity; identity: (value: Entity) => string; payload: (value: Entity) => object;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [pending, setPending] = useState(new Set<string>());
  const scopeKey = `${endpoint}:${userId}`;
  const [loadedScope, setLoadedScope] = useState(scopeKey);
  const inflight = useRef(new Set<string>()); const revision = useRef(0);
  const lifetime = useRef<AbortController | null>(null); const reading = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!lifetime.current || lifetime.current.signal.aborted || reading.current === lifetime.current || inflight.current.size) return;
    const controller = lifetime.current; const signal = controller.signal; const before = revision.current;
    reading.current = controller; setLoading(true); setError('');
    try {
      const collection = new Map<string, T>(); let after: string | null = null;
      do {
        const page = pageSchema.parse(await mediaResponse(await fetch(`${endpoint}${after ? `?after=${after}` : ''}`, { cache: 'no-store', signal })));
        for (const item of page.items) collection.set(item.id, item);
        if (page.next && after && page.next <= after) throw new Error('Не вдалося завантажити наступну сторінку улюблених.');
        after = page.next;
      } while (after && !signal.aborted);
      if (!signal.aborted && before === revision.current) setItems([...collection.values()]);
    } catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'Не вдалося завантажити улюблені.'); }
    finally { if (reading.current === controller) reading.current = null; if (!signal.aborted) setLoading(false); }
  }, [endpoint, pageSchema]);
  useEffect(() => {
    setLoadedScope(scopeKey); setItems([]); setPending(new Set()); setError(''); setLoading(true);
    inflight.current = new Set(); revision.current++;
    if (!enabled) return;
    const controller = new AbortController(); lifetime.current = controller;
    void refresh(); return () => { controller.abort(); };
  }, [refresh, enabled, scopeKey]);
  const toggle = useCallback(async (value: Entity) => {
    const key = identity(value); const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || inflight.current.has(key) || loading) return;
    const mutations = inflight.current;
    mutations.add(key); revision.current++; setPending(new Set(mutations)); setError('');
    const liked = !items.some((item) => identity(entity(item)) === key && item.likedBy.some((like) => like.userId === userId));
    try {
      const result = itemSchema.parse(await mediaResponse(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload(value), liked }), signal })));
      if (!signal.aborted) setItems((current) => [...current.filter((item) => identity(entity(item)) !== key), ...(result.item ? [result.item] : [])]);
    } catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'Не вдалося зберегти сердечко.'); }
    finally { mutations.delete(key); if (!signal.aborted) setPending(new Set(mutations)); }
  }, [identity, loading, items, entity, userId, itemSchema, endpoint, payload]);
  return useMemo(() => loadedScope === scopeKey && enabled ? { items, loading, error, pending, refresh, toggle } : { items: [] as T[], loading: true, error: '', pending: new Set<string>(), refresh, toggle }, [loadedScope, scopeKey, enabled, items, loading, error, pending, refresh, toggle]);
}
