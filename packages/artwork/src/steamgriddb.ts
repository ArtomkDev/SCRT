import { z } from 'zod';
import { artworkUrlSchema } from '@scrt/validation';
import type { ArtworkAsset, ArtworkGalleryResult } from '@scrt/shared';
import { ArtworkHttp } from './http';
import { ArtworkLookupCache } from './lookup-cache';
import { canonicalArtworkName, chooseArtworkCandidate } from './matching';
import type { ActivityArtworkProvider, ArtworkLookupInput, ArtworkProviderResult } from './types';

const candidatesSchema = z.object({ success: z.literal(true), data: z.array(z.object({ id: z.number().int().positive(), name: z.string().max(256) })).max(100) });
const assetsSchema = z.object({ success: z.literal(true), data: z.array(z.object({
  id: z.number(), url: z.string().max(2048), width: z.number().optional(), height: z.number().optional(), score: z.number().optional(),
  thumb: z.string().max(2048).optional(), style: z.union([z.string(), z.array(z.string())]).optional(), mime: z.string().optional(), nsfw: z.boolean().optional(), humor: z.boolean().optional(), epilepsy: z.boolean().optional(), animated: z.boolean().optional(),
})).max(100) });
type SteamAsset = z.infer<typeof assetsSchema>['data'][number];
export function safeSteamAssets(assets: readonly SteamAsset[], kind: ArtworkAsset['kind']) {
  return assets.filter((asset) => !asset.nsfw && !asset.humor && !asset.epilepsy && !asset.animated
    && (!asset.mime || ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(asset.mime))
    && artworkUrlSchema.safeParse(asset.url).success && new URL(asset.url).hostname === 'cdn2.steamgriddb.com'
    && (kind !== 'icon' || (asset.width ?? 128) <= 4096 && (asset.height ?? 128) <= 4096)
    && (kind !== 'logo' || (asset.width ?? 512) <= 4096 && (asset.height ?? 512) <= 4096)
    && (kind !== 'hero' || (asset.width ?? 0) > (asset.height ?? 0) && (asset.width ?? 0) <= 7680)
  ).sort((a, b) => Number(Array.isArray(b.style) ? b.style.includes('official') : b.style === 'official') - Number(Array.isArray(a.style) ? a.style.includes('official') : a.style === 'official')
    || Math.abs((a.width ?? 128) - (kind === 'hero' ? 1280 : kind === 'icon' ? 128 : 512)) - Math.abs((b.width ?? 128) - (kind === 'hero' ? 1280 : kind === 'icon' ? 128 : 512))
    || (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);
}
export function selectSteamAsset(assets: readonly SteamAsset[], kind: ArtworkAsset['kind']) {
  return safeSteamAssets(assets, kind)[0] ?? null;
}
export class SteamGridDBArtworkProvider implements ActivityArtworkProvider {
  readonly id = 'steamgriddb';
  private readonly http: ArtworkHttp;
  private readonly searches = new ArtworkLookupCache<z.infer<typeof candidatesSchema>>();
  constructor(private readonly key?: string, fetcher?: typeof fetch) { this.http = new ArtworkHttp(Boolean(key), 300, fetcher); }
  health() { return this.http.health(); }
  private async request(path: string, signal: AbortSignal) {
    return this.http.json(`https://www.steamgriddb.com/api/v2/${path}`, { headers: { Authorization: `Bearer ${this.key}` } }, signal);
  }
  private search(name: string, signal: AbortSignal) {
    const query = canonicalArtworkName(name);
    return this.searches.get(query, async () => candidatesSchema.parse(await this.request(`search/autocomplete/${encodeURIComponent(query)}`, signal)));
  }
  async gallery(input: ArtworkLookupInput, field: 'icon' | 'hero', page: number, signal: AbortSignal): Promise<ArtworkGalleryResult> {
    if (!this.key) return { assets: [], games: [], nextPage: null };
    const games = input.mapping?.provider === this.id
      ? [{ id: Number(input.mapping.entityId), name: input.displayName }]
      : (await this.search(input.displayName, signal)).data;
    const matched = input.mapping?.provider === this.id ? games[0] : chooseArtworkCandidate(input.displayName, games)?.candidate;
    const choices = games.map((game) => ({ id: String(game.id), name: game.name }));
    if (!matched) return { assets: [], games: choices, nextPage: null };
    const fields = field === 'hero' ? [['heroes', 'hero']] as const : [['icons', 'icon'], ['logos', 'logo'], ['grids', 'cover']] as const;
    const pages = await Promise.allSettled(fields.map(async ([endpoint, kind]) => {
      const response = assetsSchema.parse(await this.request(`${endpoint}/game/${matched.id}?types=static&nsfw=false&humor=false&epilepsy=false&page=${page}`, signal));
      return { more: response.data.length > 0, assets: safeSteamAssets(response.data, kind).map((image) => ({
        asset: { url: image.url, source: this.id, kind, entityId: String(matched.id), attributionUrl: `https://www.steamgriddb.com/game/${matched.id}` } satisfies ArtworkAsset,
        title: `${matched.name} · ${kind} · ${image.width ?? '?'}×${image.height ?? '?'}`,
        previewUrl: image.thumb && artworkUrlSchema.safeParse(image.thumb).success && new URL(image.thumb).hostname === 'cdn2.steamgriddb.com' ? image.thumb : image.url,
      })) };
    }));
    const successful = pages.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    return { assets: successful.flatMap((result) => result.assets), games: choices, nextPage: page < 100 && successful.some((result) => result.more) ? page + 1 : null, failed: pages.some((result) => result.status === 'rejected') };
  }
  async resolve(input: ArtworkLookupInput, signal: AbortSignal): Promise<ArtworkProviderResult | null> {
    if (!this.key || input.classification === 'application' && input.mapping?.provider !== this.id || input.mapping && input.mapping.provider !== this.id) return null;
    let entityId = input.mapping?.entityId;
    let name = input.displayName;
    let confidence = 1;
    if (!entityId) {
      const response = await this.search(name, signal);
      const match = chooseArtworkCandidate(name, response.data);
      if (!match) return null;
      entityId = String(match.candidate.id); name = match.candidate.name; confidence = match.confidence;
    }
    const fields = [
      ...(input.needs.icon ? [['icons', 'icon'], ['logos', 'logo'], ['grids', 'cover']] as const : []),
      ...(input.needs.hero ? [['heroes', 'hero']] as const : []),
    ];
    const results = await Promise.allSettled(fields.map(async ([endpoint, kind]) => {
      // MIME query values vary by endpoint (icons/logos reject JPEG/WebP).
      // Request static assets and apply the existing MIME safety filter locally.
      const response = assetsSchema.parse(await this.request(`${endpoint}/game/${entityId}?types=static&nsfw=false&humor=false&epilepsy=false${kind === 'cover' ? '&dimensions=600x900' : ''}`, signal));
      const chosen = selectSteamAsset(response.data, kind);
      return { kind, asset: chosen ? { url: chosen.url, source: this.id, kind, entityId: entityId!, attributionUrl: `https://www.steamgriddb.com/game/${entityId}` } satisfies ArtworkAsset : null };
    }));
    // SteamGridDB also indexes software/tools; its name match alone does not establish a game classification.
    const result: ArtworkProviderResult = { classification: 'unknown', resolvedName: name.slice(0, 128), confidence, failed: results.some((item) => item.status === 'rejected') };
    for (const item of results) if (item.status === 'fulfilled') result[item.value.kind] = item.value.asset;
    // A portrait grid is metadata only; it does not displace IGDB or software logos as an icon.
    return result;
  }
}
