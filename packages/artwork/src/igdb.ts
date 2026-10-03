import { z } from 'zod';
import type { ArtworkAsset, ArtworkGalleryCandidate, ArtworkGalleryResult } from '@scrt/shared';
import { ArtworkHttp, ArtworkProviderError } from './http';
import { ArtworkLookupCache } from './lookup-cache';
import { canonicalArtworkName, chooseArtworkCandidate } from './matching';
import type { ActivityArtworkProvider, ArtworkLookupInput, ArtworkProviderResult } from './types';

const imageSchema = z.object({ image_id: z.string().regex(/^[A-Za-z0-9_]+$/u).max(128), animated: z.boolean().optional(), width: z.number().optional(), height: z.number().optional() });
const gamesSchema = z.array(z.object({ id: z.number().int().positive(), name: z.string().max(256), alternative_names: z.array(z.object({ name: z.string().max(256) })).max(100).optional(), cover: imageSchema.optional(), artworks: z.array(imageSchema).max(500).optional(), screenshots: z.array(imageSchema).max(500).optional() })).max(20);
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
export class IgdbArtworkProvider implements ActivityArtworkProvider {
  readonly id = 'igdb';
  private token: { value: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly http: ArtworkHttp;
  private readonly games = new ArtworkLookupCache<z.infer<typeof gamesSchema>>();
  constructor(private readonly clientId?: string, private readonly secret?: string, fetcher?: typeof fetch) { this.http = new ArtworkHttp(Boolean(clientId && secret), 300, fetcher); }
  health() { return this.http.health(); }
  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.http.json('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: this.clientId!, client_secret: this.secret!, grant_type: 'client_credentials' }) }, signal).then((raw) => {
      const token = tokenSchema.parse(raw);
      this.token = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
      return token.access_token;
    }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  private async request(endpoint: string, body: string, signal: AbortSignal) {
    const token = await this.accessToken(signal);
    try { return await this.http.json(`https://api.igdb.com/v4/${endpoint}`, { method: 'POST', headers: { 'Client-ID': this.clientId!, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body }, signal); }
    catch (error) { if (error instanceof ArtworkProviderError && error.status === 'authorization_error') this.token = null; throw error; }
  }
  private findGames(input: ArtworkLookupInput, signal: AbortSignal) {
    const query = input.mapping?.provider === this.id ? `where id = ${input.mapping.entityId};` : `search ${JSON.stringify(canonicalArtworkName(input.displayName))};`;
    const fields = 'id,name,alternative_names.name,cover.image_id,cover.animated,artworks.image_id,artworks.animated,artworks.width,artworks.height,screenshots.image_id,screenshots.animated,screenshots.width,screenshots.height';
    return this.games.get(query, async () => gamesSchema.parse(await this.request('games', `fields ${fields}; ${query} limit 20;`, signal)));
  }
  async gallery(input: ArtworkLookupInput, field: 'icon' | 'hero', _page: number, signal: AbortSignal): Promise<ArtworkGalleryResult> {
    if (!this.clientId || !this.secret) return { assets: [], games: [], nextPage: null };
    const games = await this.findGames(input, signal);
    const match = input.mapping?.provider === this.id ? games.find((game) => String(game.id) === input.mapping?.entityId) : chooseArtworkCandidate(input.displayName, games.map((game) => ({ ...game, aliases: game.alternative_names?.map((alias) => alias.name) })))?.candidate;
    const game = games.find((item) => item.id === match?.id);
    const choices = games.map((item) => ({ id: String(item.id), name: item.name }));
    if (!game) return { assets: [], games: choices, nextPage: null };
    const assets: ArtworkGalleryCandidate[] = [];
    const add = (images: z.infer<typeof imageSchema>[], kind: ArtworkAsset['kind'], size: string) => {
      for (const image of images) {
        if (image.animated || kind === 'hero' && (image.width ?? 0) <= (image.height ?? 0)) continue;
        const url = `https://images.igdb.com/igdb/image/upload/t_${size}/${image.image_id}.jpg`;
        assets.push({ asset: { url, source: this.id, kind, entityId: String(game.id), attributionUrl: 'https://www.igdb.com' }, title: `${game.name} · ${kind}`, previewUrl: url });
      }
    };
    let failed = false;
    if (field === 'hero') { add(game.artworks ?? [], 'hero', '720p'); add(game.screenshots ?? [], 'hero', '720p'); }
    else {
      if (game.cover) add([game.cover], 'cover', 'cover_small');
      try { add(z.array(imageSchema).max(100).parse(await this.request('logos', `fields image_id,animated; where game = ${game.id}; limit 100;`, signal)), 'logo', 'logo_med'); }
      catch { failed = true; }
    }
    return { assets, games: choices, nextPage: null, failed };
  }
  async resolve(input: ArtworkLookupInput, signal: AbortSignal): Promise<ArtworkProviderResult | null> {
    if (!this.clientId || !this.secret || input.classification === 'application' && input.mapping?.provider !== this.id || input.mapping && input.mapping.provider !== this.id) return null;
    const games = await this.findGames(input, signal);
    const matched = input.mapping ? games.find((game) => String(game.id) === input.mapping?.entityId) : chooseArtworkCandidate(input.displayName, games.map((game) => ({ ...game, aliases: game.alternative_names?.map((alias) => alias.name) })))?.candidate;
    const game = games.find((entry) => entry.id === matched?.id);
    if (!game) return null;
    const asset = (image: z.infer<typeof imageSchema> | undefined, kind: ArtworkAsset['kind'], size: string): ArtworkAsset | null => image && !image.animated ? { url: `https://images.igdb.com/igdb/image/upload/t_${size}/${image.image_id}.jpg`, kind, source: this.id, entityId: String(game.id), attributionUrl: 'https://www.igdb.com' } : null;
    const landscape = (images?: z.infer<typeof imageSchema>[]) => images?.find((image) => !image.animated && (image.width ?? 0) > (image.height ?? 0));
    const result: ArtworkProviderResult = { cover: asset(game.cover, 'cover', 'cover_small'), hero: input.needs.hero ? asset(landscape(game.artworks) ?? landscape(game.screenshots), 'hero', '720p') : null, classification: 'game', resolvedName: game.name, confidence: 1 };
    if (input.needs.icon) {
      try {
        const logos = z.array(imageSchema).max(10).parse(await this.request('logos', `fields image_id,animated; where game = ${game.id}; limit 10;`, signal));
        result.logo = asset(logos.find((logo) => !logo.animated), 'logo', 'logo_med');
      } catch { result.failed = true; }
      result.icon = result.logo ?? result.cover;
    }
    return result;
  }
}
