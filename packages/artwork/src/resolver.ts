import type { ActivityArtwork, ArtworkIdentity } from '@scrt/shared';
import { activityArtworkSchema, artworkIdentitySchema, artworkOverridesSchema, guildIdSchema } from '@scrt/validation';
import { isKnownSoftware } from './local-providers';
import type { ActivityArtworkProvider, ArtworkProviderResult, ArtworkStore, ProviderHealth } from './types';

export const ARTWORK_TTL = { success: 30 * 86400_000, incomplete: 6 * 3600_000, notFound: 6 * 3600_000, error: 5 * 60_000, manualRefresh: 60_000 } as const;
export const ARTWORK_PROVIDER_TIMEOUT_MS = 5000;
const sourcePriority = ['manual', 'discord', 'steamgriddb', 'igdb', 'simple-icons', 'brand', 'generated'];
export function generatedArtwork(input: ArtworkIdentity, now = Date.now()): ActivityArtwork {
  return { gameKey: input.gameKey, observedName: input.displayName, classification: isKnownSoftware(input.displayName) ? 'application' : 'unknown', icon: null, logo: null, hero: null, cover: null, dominantColor: null, resolvedName: null, confidence: 0, status: 'not_found', resolvedAt: 0, nextRefreshAt: now, overrides: { iconUrl: null, heroUrl: null }, mapping: null, discord: { iconUrl: null, heroUrl: null }, schemaVersion: 1, revision: 0 };
}
export class ActivityArtworkResolver {
  private readonly pending = new Map<string, Promise<ActivityArtwork>>();
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly store: ArtworkStore, private readonly providers: readonly ActivityArtworkProvider[], private readonly timeoutMs = ARTWORK_PROVIDER_TIMEOUT_MS) {}
  health(): Record<string, ProviderHealth> { return Object.fromEntries(this.providers.map((provider) => [provider.id, provider.health()])); }
  provider(id: string) { return this.providers.find((provider) => provider.id === id && provider.id !== 'generated'); }
  private version() { return `4:${this.providers.map((provider) => `${provider.id}:${Number(provider.health().status !== 'not_configured')}`).join(',')}`; }
  needsRefresh(cached: ActivityArtwork | null | undefined) { return !cached || cached.resolutionVersion !== this.version() || cached.nextRefreshAt <= Date.now(); }
  async resolve(guildId: string, identity: ArtworkIdentity, options: { force?: boolean; discord?: ActivityArtwork['discord'] } = {}): Promise<ActivityArtwork> {
    guildIdSchema.parse(guildId); artworkIdentitySchema.parse(identity);
    if (options.discord) artworkOverridesSchema.parse(options.discord);
    const key = `${guildId}:${identity.gameKey}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 200) return generatedArtwork(identity);
    const pending = this.work(guildId, identity, options).finally(() => { this.pending.delete(key); });
    this.pending.set(key, pending);
    return pending;
  }
  private async work(guildId: string, identity: ArtworkIdentity, options: { force?: boolean; discord?: ActivityArtwork['discord'] }): Promise<ActivityArtwork> {
    const cached = await this.store.get(guildId, identity.gameKey);
    const newDiscord = options.discord && (options.discord.iconUrl || options.discord.heroUrl) && JSON.stringify(options.discord) !== JSON.stringify(cached?.discord);
    if (cached && !newDiscord && cached.resolutionVersion === this.version() && (!this.needsRefresh(cached) && !options.force || options.force && cached.resolvedAt > Date.now() - ARTWORK_TTL.manualRefresh)) return cached;
    if (this.active >= 2) await new Promise<void>((done) => this.waiting.push(done)); else this.active++;
    try { return await this.enrich(guildId, identity, cached, newDiscord ? options.discord : undefined); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
  private async providerResult(provider: ActivityArtworkProvider, input: Parameters<ActivityArtworkProvider['resolve']>[0]) {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        provider.resolve(input, controller.signal),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Artwork timeout')); }, this.timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  private async enrich(guildId: string, identity: ArtworkIdentity, cached: ActivityArtwork | null, discord?: ActivityArtwork['discord']): Promise<ActivityArtwork> {
    const output = generatedArtwork(identity);
    output.resolutionVersion = this.version();
    output.overrides = cached?.overrides ?? output.overrides;
    output.selections = cached?.selections ?? { icon: null, hero: null };
    output.mapping = cached?.mapping ?? null;
    output.revision = cached?.revision ?? 0;
    output.discord = discord ?? cached?.discord ?? output.discord;
    const failed = new Set<string>();
    for (const provider of this.providers) {
      const needs = { icon: !output.icon && !output.overrides.iconUrl, hero: !output.hero && !output.overrides.heroUrl };
      if (!needs.icon && !needs.hero) break;
      try {
        const result = await this.providerResult(provider, { ...identity, classification: output.classification, discord: output.discord, mapping: output.mapping, needs });
        if (!result) continue;
        if (result.failed) failed.add(provider.id);
        this.merge(output, result);
      } catch { failed.add(provider.id); }
    }
    for (const field of ['icon', 'hero', 'logo', 'cover'] as const) {
      const old = cached?.[field];
      const selected = output[field];
      if (old && failed.has(old.source) && (!selected || sourcePriority.indexOf(old.source) < sourcePriority.indexOf(selected.source))) output[field] = old;
    }
    const found = Boolean(output.icon || output.hero || output.overrides.iconUrl || output.overrides.heroUrl);
    const complete = Boolean((output.icon || output.overrides.iconUrl) && (output.hero || output.overrides.heroUrl));
    output.status = failed.size ? 'error' : found ? 'resolved' : 'not_found';
    output.resolvedAt = Date.now();
    output.nextRefreshAt = output.resolvedAt + (failed.size ? ARTWORK_TTL.error : complete ? ARTWORK_TTL.success : found ? ARTWORK_TTL.incomplete : ARTWORK_TTL.notFound);
    const validated = activityArtworkSchema.parse(output);
    const saved = await this.store.saveResolved(guildId, validated, cached);
    await this.store.saveProviderHealth(guildId, this.health()).catch(() => undefined);
    return saved ?? validated;
  }
  private merge(output: ActivityArtwork, result: ArtworkProviderResult) {
    output.icon ??= result.icon ?? result.logo ?? null;
    output.hero ??= result.hero ?? null;
    output.logo ??= result.logo ?? null;
    output.cover ??= result.cover ?? null;
    output.dominantColor ??= result.dominantColor ?? null;
    output.resolvedName ??= result.resolvedName?.slice(0, 128) ?? null;
    if (result.classification && output.classification === 'unknown') output.classification = result.classification;
    output.confidence = Math.max(output.confidence, result.confidence);
  }
}
