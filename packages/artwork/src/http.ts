import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderHealth } from './types';

export class ArtworkProviderError extends Error {
  constructor(readonly status: ProviderHealth['status']) { super(`Artwork provider ${status}`); }
}
/** Per-process paced requests, no retry loops, and shared cooldown (including Retry-After). */
export class ArtworkHttp {
  private nextRequestAt = 0;
  private blockedUntil = 0;
  private state: ProviderHealth;
  constructor(configured: boolean, private readonly intervalMs: number, private readonly fetcher: typeof fetch = fetch) {
    this.state = { status: configured ? 'configured' : 'not_configured', checkedAt: 0 };
  }
  health() { return this.state; }
  async json(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    if (this.blockedUntil > Date.now()) throw new ArtworkProviderError(this.state.status);
    const slot = Math.max(Date.now(), this.nextRequestAt);
    this.nextRequestAt = slot + this.intervalMs;
    try {
      if (slot > Date.now()) await delay(slot - Date.now(), undefined, { signal });
      if (this.blockedUntil > Date.now()) throw new ArtworkProviderError(this.state.status);
      const request: RequestInit & { cache: 'no-store' } = { ...init, signal, cache: 'no-store', redirect: 'error' };
      const response = await this.fetcher(url, request);
      if (!response.ok) {
        const status = response.status === 401 || response.status === 403 ? 'authorization_error' : response.status === 429 ? 'rate_limited' : 'unavailable';
        const retry = response.headers.get('retry-after');
        const retryMs = retry ? (/^\d+$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 60_000;
        this.blockedUntil = Date.now() + (status === 'authorization_error' ? 3600_000 : Number.isFinite(retryMs) ? Math.max(60_000, retryMs) : 60_000);
        this.state = { status, checkedAt: Date.now() };
        throw new ArtworkProviderError(status);
      }
      const body = await response.text();
      if (body.length > 2_000_000) throw new ArtworkProviderError('unavailable');
      const result: unknown = JSON.parse(body);
      if (this.blockedUntil <= Date.now()) this.state = { status: 'ok', checkedAt: Date.now() };
      return result;
    } catch (error) {
      if (error instanceof ArtworkProviderError) throw error;
      this.blockedUntil = Math.max(this.blockedUntil, Date.now() + 60_000);
      this.state = { status: 'unavailable', checkedAt: Date.now() };
      // Do not propagate fetch errors: they can contain credential-bearing URLs/headers.
      throw new ArtworkProviderError('unavailable');
    }
  }
}
