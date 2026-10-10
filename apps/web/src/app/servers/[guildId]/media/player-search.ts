'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { mediaSearchResultSchema, mediaTrackSchema, type MediaSnapshot } from '@scrt/validation';
import { mediaResponse } from './player-controller';

const searchStateSchema = z.object({
  version: z.literal(1), savedAt: z.number(), query: z.string().max(250), submittedQuery: z.string().max(250),
  results: z.array(mediaTrackSchema).max(200), searched: z.boolean(),
  source: z.enum(['all', 'playable', 'direct', 'youtube', 'soundcloud']),
  mobileTab: z.enum(['search', 'queue']), nextPage: z.number().int().min(1).max(9).nullable(),
});
type SearchState = z.infer<typeof searchStateSchema>;
const empty: SearchState = { version: 1, savedAt: 0, query: '', submittedQuery: '', results: [], searched: false, source: 'all', mobileTab: 'search', nextPage: null };
const lifetime = 24 * 60 * 60 * 1000;

export function usePlayerSearch(guildId: string, userId: string, providers: MediaSnapshot['providers'], setMessage: (value: string) => void) {
  // Only public catalog data and UI preferences are restored. Permissions and live audio state always come from the worker.
  const key = `scrt:media-search:v1:${userId}:${guildId}`;
  const [state, setState] = useState(empty);
  const [scope, setScope] = useState('');
  const ready = scope === key;
  const [searchPending, setSearchPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    let restored = empty;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw && raw.length <= 1500000) {
        const parsed = searchStateSchema.safeParse(JSON.parse(raw));
        if (parsed.success && Date.now() - parsed.data.savedAt < lifetime && parsed.data.savedAt <= Date.now()) restored = parsed.data;
      }
    } catch { /* Storage may be disabled; the current page still works. */ }
    setState(restored); setScope(key);
    return () => { request.current?.abort(); request.current = null; };
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(key, JSON.stringify({ ...state, savedAt: Date.now() })); }
    catch { /* Quota or private-browser restrictions must not block playback. */ }
  }, [key, state, ready]);

  async function search(more = false, queryOverride?: string) {
    if (request.current || !ready || more && state.nextPage === null) return;
    const query = (more ? state.submittedQuery : queryOverride ?? state.query).trim();
    if (query.length < 2) return;
    const page = more ? state.nextPage! : 0;
    const controller = new AbortController(); request.current = controller;
    if (queryOverride !== undefined && !more) setState((previous) => ({ ...previous, query }));
    setSearchPending(true); setMessage('');
    try {
      const params = new URLSearchParams({ q: query, page: String(page) });
      const value = mediaSearchResultSchema.parse(await mediaResponse(await fetch(`/api/guilds/${guildId}/media?${params}`, { cache: 'no-store', signal: controller.signal })));
      if (controller.signal.aborted) return;
      setState((previous) => {
        const unique = new Map((more ? previous.results : []).map((track) => [`${track.provider}:${track.providerItemId}`, track]));
        for (const track of value.results) unique.set(`${track.provider}:${track.providerItemId}`, track);
        const results = [...unique.values()].slice(0, 200);
        return { ...previous, results, searched: true, submittedQuery: query, nextPage: results.length < 200 && value.nextPage !== null && value.nextPage > page ? value.nextPage : null };
      });
      const missing = providers.filter((provider) => provider.state === 'unconfigured' && value.unavailable.includes(provider.name));
      if (value.errors.length) setMessage(value.errors.join(' '));
      else if (missing.length) setMessage(`Не налаштовано пошук: ${missing.map((provider) => provider.name).join(', ')}. Спробуйте інше джерело.`);
      else if (value.unavailable.length) setMessage(`Тимчасово недоступні джерела: ${value.unavailable.join(', ')}.`);
      else if (!value.results.length) setMessage(more ? 'Усі результати завантажено.' : 'Нічого не знайдено. Спробуйте інший запит або посилання.');
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Пошук недоступний.');
    } finally {
      if (request.current === controller) { request.current = null; setSearchPending(false); }
    }
  }
  return {
    ...state, searchPending, search,
    setQuery: (query: string) => setState((value) => ({ ...value, query })),
    setSource: (source: SearchState['source']) => setState((value) => ({ ...value, source })),
    setMobileTab: (mobileTab: SearchState['mobileTab']) => setState((value) => ({ ...value, mobileTab })),
  };
}
