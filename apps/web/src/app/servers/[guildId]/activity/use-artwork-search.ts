'use client';
import { useEffect, useRef, useState } from 'react';
import { streamArtworkSearch } from '@/lib/artwork-search-client';
import { artworkSearchCacheKey, artworkSources, cachedArtworkSearch, rememberArtworkSearch, type ArtworkField, type ArtworkResults, type GallerySource } from '@/lib/artwork-editor';

export function useArtworkSearch(guildId: string, gameKey: string, revision: number, name: string) {
  const initialKey = artworkSearchCacheKey(guildId, gameKey, revision, name);
  const [results, setResults] = useState<ArtworkResults>(() => cachedArtworkSearch(initialKey) ?? { icon: {}, hero: {} });
  const [query, setQuery] = useState(name);
  const [searched, setSearched] = useState(() => Boolean(cachedArtworkSearch(initialKey)));
  const requested = useRef(searched);
  const latest = useRef(results);
  const controllers = useRef(new Map<GallerySource, AbortController>());
  const publication = useRef<ReturnType<typeof setTimeout> | null>(null);

  function publish(next: ArtworkResults, immediate = false) {
    latest.current = next;
    if (immediate) {
      if (publication.current) clearTimeout(publication.current);
      publication.current = null;
      setResults(next);
    } else if (!publication.current) {
      // Aggregate streaming replies briefly; keep provider ranking stable between batches.
      publication.current = setTimeout(() => { publication.current = null; setResults(latest.current); }, 180);
    }
  }

  useEffect(() => {
    const requests = controllers.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      if (publication.current) clearTimeout(publication.current);
    };
  }, []);

  async function load(source: GallerySource, searchQuery: string, entityId?: string, page = 0, field: ArtworkField | 'both' = 'both') {
    controllers.current.get(source)?.abort();
    const controller = new AbortController();
    controllers.current.set(source, controller);
    const fields: ArtworkField[] = field === 'both' ? ['icon', 'hero'] : [field];
    const next = { ...latest.current };
    for (const target of fields) next[target] = { ...next[target], [source]: { loading: true, entityId, result: page ? next[target][source]?.result : undefined } };
    publish(next, true);
    try {
      await streamArtworkSearch(guildId, { gameKey, source, query: searchQuery, field, entityId, page }, controller.signal, (update) => {
        if (controller.signal.aborted) return;
        const previous = page ? latest.current[update.field][source]?.result?.assets ?? [] : [];
        const result = update.result ? { ...update.result, assets: [...new Map([...previous, ...update.result.assets].map((candidate) => [candidate.asset.url, candidate])).values()] } : undefined;
        publish({ ...latest.current, [update.field]: { ...latest.current[update.field], [source]: { loading: false, entityId, result, unavailable: Boolean(update.error || result?.failed || result?.status === 'error') } } });
      });
    } catch {
      // Keep successful providers usable; transport/provider details stay out of the UI.
    } finally {
      if (!controller.signal.aborted) {
        const completed = { ...latest.current };
        for (const target of fields) {
          const state = completed[target][source];
          if (state?.loading) completed[target] = { ...completed[target], [source]: { ...state, loading: false, unavailable: true } };
        }
        publish(completed);
        controllers.current.delete(source);
        if (!controllers.current.size) rememberArtworkSearch(artworkSearchCacheKey(guildId, gameKey, revision, searchQuery), completed);
      }
    }
  }

  function search(value: string) {
    const searchQuery = value.trim();
    if (!searchQuery) return;
    if (searchQuery === query && controllers.current.size) return;
    requested.current = true;
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setQuery(searchQuery); setSearched(true);
    publish({ icon: {}, hero: {} }, true);
    for (const [source] of artworkSources) void load(source, searchQuery);
  }

  useEffect(() => {
    // Defer one turn so Strict Mode's effect replay cannot duplicate the first batch.
    const initialSearch = setTimeout(() => { if (!requested.current) search(name); }, 0);
    return () => clearTimeout(initialSearch);
  }, [initialKey]);

  return { results, query, searched, search, refine: (source: GallerySource, entityId?: string) => void load(source, query, entityId),
    more: (field: ArtworkField, filter: GallerySource | 'all') => {
      for (const [source] of artworkSources) {
        if (filter !== 'all' && filter !== source) continue;
        const state = latest.current[field][source];
        if (!state?.loading && state?.result?.nextPage != null) void load(source, query, state.entityId, state.result.nextPage, field);
      }
    } };
}
