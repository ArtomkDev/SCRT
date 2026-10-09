import type { MediaQueueItem } from '@scrt/shared';
export function scheduledQueue(queue: readonly MediaQueueItem[], mode: 'normal' | 'fair', lastRequesterId: string | null = null): MediaQueueItem[] {
  if (mode === 'normal') return [...queue];
  const groups = new Map<string, MediaQueueItem[]>();
  for (const item of queue) { const group = groups.get(item.requestedByUserId) ?? []; group.push(item); groups.set(item.requestedByUserId, group); }
  const requesters = [...groups.keys()];
  const last = requesters.indexOf(lastRequesterId ?? ''); if (last >= 0) requesters.push(...requesters.splice(0, last + 1));
  const result: MediaQueueItem[] = [];
  while (result.length < queue.length) for (const id of requesters) { const item = groups.get(id)?.shift(); if (item) result.push(item); }
  return result;
}
export function voteThreshold(listeners: readonly string[], ratio: number): number { return Math.max(1, Math.ceil(new Set(listeners).size * ratio)); }
export function countedVotes(votes: ReadonlySet<string>, listeners: readonly string[]): number { return [...new Set(listeners)].filter((id) => votes.has(id)).length; }
