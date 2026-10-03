import { randomUUID } from 'node:crypto';
import type { MessageIncrement } from '@scrt/database';

type PendingBatch = { guildId: string; token: string; values: MessageIncrement[] };
/** Committed snapshots keep their retry token, while arrivals enter a separate buffer. */
export class MessageActivityBuffer {
  private readonly pending = new Map<string, MessageIncrement & { guildId: string }>();
  private readonly batches: PendingBatch[] = [];
  private running: Promise<void> | null = null;
  constructor(private readonly commit: (guildId: string, token: string, values: readonly MessageIncrement[]) => Promise<void>, private readonly maxEntries = 2000) {}
  get size() { return this.pending.size + this.batches.reduce((sum, batch) => sum + batch.values.length, 0); }
  add(guildId: string, userId: string, date: string, observedAt: number): void {
    const key = `${guildId}:${userId}:${date}`;
    const prior = this.pending.get(key);
    if (prior) { prior.count++; prior.observedAt = Math.max(prior.observedAt, observedAt); return; }
    if (this.size >= this.maxEntries) throw new Error('Activity message buffer is full; event rejected');
    this.pending.set(key, { guildId, userId, date, count: 1, observedAt });
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.flushPending().finally(() => { this.running = null; });
    return this.running;
  }
  private async flushPending() {
    const groups = new Map<string, MessageIncrement[]>();
    for (const { guildId, ...value } of this.pending.values()) { const group = groups.get(guildId) ?? []; group.push(value); groups.set(guildId, group); }
    this.pending.clear();
    for (const [guildId, values] of groups) for (let offset = 0; offset < values.length; offset += 80) this.batches.push({ guildId, token: randomUUID(), values: values.slice(offset, offset + 80) });
    // A failed commit leaves the immutable snapshot at the front for retry.
    while (this.batches.length) { const batch = this.batches[0]!; await this.commit(batch.guildId, batch.token, batch.values); this.batches.shift(); }
  }
}
