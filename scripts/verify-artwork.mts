import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createArtworkResolver } from '../packages/artwork/src/index.ts';
import type { ActivityArtwork } from '../packages/shared/src/activity-artwork.ts';

const require = createRequire(resolve('apps/bot/package.json'));
const dotenv = require('dotenv') as { config: (options: { path: string }) => unknown };
dotenv.config({ path: '.env' });
const config = {
  STEAMGRIDDB_API_KEY: process.env.STEAMGRIDDB_API_KEY?.trim() || undefined,
  IGDB_TWITCH_CLIENT_ID: process.env.IGDB_TWITCH_CLIENT_ID?.trim() || undefined,
  IGDB_TWITCH_CLIENT_SECRET: process.env.IGDB_TWITCH_CLIENT_SECRET?.trim() || undefined,
};
const records = new Map<string, ActivityArtwork>();
const resolver = createArtworkResolver({
  get: async (guildId, key) => records.get(`${guildId}:${key}`) ?? null,
  saveResolved: async (guildId, artwork) => { records.set(`${guildId}:${artwork.gameKey}`, artwork); return artwork; },
  saveProviderHealth: async () => undefined,
}, config);
console.log(JSON.stringify({ steamgriddb: config.STEAMGRIDDB_API_KEY ? 'CONFIGURED' : 'BLOCKED: missing credentials', igdb: config.IGDB_TWITCH_CLIENT_ID && config.IGDB_TWITCH_CLIENT_SECRET ? 'CONFIGURED' : 'BLOCKED: missing credentials', persistence: 'in-memory only' }));
async function checkImage(name: string, field: string, url: string) {
  const host = new URL(url).hostname;
  if (!['code.visualstudio.com', 'cdn2.steamgriddb.com', 'images.igdb.com'].includes(host)) return;
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(8000) });
    console.log(JSON.stringify({ name, field, imageHttpStatus: response.status, contentType: response.headers.get('content-type') }));
  } catch { console.log(JSON.stringify({ name, field, result: 'BLOCKED: image request failed' })); }
}
for (const displayName of ['Dota 2', 'Valheim', 'Crosshair X', 'Rust', 'Visual Studio Code']) {
  try {
    const result = await resolver.resolve('12345678901234567', { gameKey: `name:${displayName.toLowerCase()}`, displayName, applicationId: null });
    console.log(JSON.stringify({ name: displayName, status: result.status, classification: result.classification, icon: result.icon?.source ?? 'generated', hero: result.hero?.source ?? 'generated', providerHealth: resolver.health() }));
    await Promise.all(['icon', 'hero'].map(async (field) => { const asset = result[field as 'icon' | 'hero']; if (asset) await checkImage(displayName, field, asset.url); }));
  } catch { console.log(JSON.stringify({ name: displayName, result: 'BLOCKED: live request failed' })); }
}
// The automatic chain can finish before IGDB, so test its credentials independently.
if (config.IGDB_TWITCH_CLIENT_ID && config.IGDB_TWITCH_CLIENT_SECRET) {
  const provider = resolver.provider('igdb')!;
  try {
    const result = await provider.resolve({ gameKey: 'name:dota 2', displayName: 'Dota 2', applicationId: null, discord: { iconUrl: null, heroUrl: null }, mapping: null, classification: 'unknown', needs: { icon: true, hero: true } }, AbortSignal.timeout(12_000));
    console.log(JSON.stringify({ independentProvider: 'igdb', health: provider.health(), iconFound: Boolean(result?.icon), heroFound: Boolean(result?.hero) }));
    if (result?.hero) await checkImage('Dota 2 · IGDB', 'hero', result.hero.url);
  } catch { console.log(JSON.stringify({ independentProvider: 'igdb', health: provider.health(), result: 'BLOCKED: live request failed' })); }
}
