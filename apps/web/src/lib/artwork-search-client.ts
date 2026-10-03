import type { ArtworkSearchUpdate } from '@scrt/shared';

export async function streamArtworkSearch(guildId: string, input: { gameKey: string; source: string; query: string; field?: 'icon' | 'hero' | 'both'; entityId?: string; page?: number }, signal: AbortSignal, update: (value: ArtworkSearchUpdate) => void) {
  const params = new URLSearchParams({ gameKey: input.gameKey, source: input.source, query: input.query, field: input.field ?? 'both', page: String(input.page ?? 0) });
  if (input.entityId) params.set('entityId', input.entityId);
  const response = await fetch(`/api/guilds/${encodeURIComponent(guildId)}/activity/artwork-search?${params}`, { signal, cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error(response.status === 401 ? 'Потрібен вхід.' : response.status === 403 ? 'Недостатньо прав.' : 'Пошук тимчасово недоступний.');
  if (!response.body) throw new Error('Не вдалося отримати результати.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split('\n'); buffered = lines.pop()!;
      for (const line of lines) if (line.trim()) update(JSON.parse(line) as ArtworkSearchUpdate);
      if (done) break;
    }
    if (buffered.trim()) update(JSON.parse(buffered) as ArtworkSearchUpdate);
  } finally { reader.releaseLock(); }
}
