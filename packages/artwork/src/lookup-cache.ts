/** Small cache of public game metadata; concurrent icon/banner lookups share one API search. */
export class ArtworkLookupCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; promise: Promise<T> }>();
  get(key: string, lookup: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.promise;
    if (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
    const promise = lookup().catch((error: unknown) => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { expiresAt: Date.now() + 5 * 60_000, promise });
    return promise;
  }
}
