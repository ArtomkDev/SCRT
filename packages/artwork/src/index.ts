export * from './types';
export * from './resolver';
export * from './matching';
export * from './local-providers';
export * from './steamgriddb';
export * from './igdb';
export * from './gallery';

import { DiscordArtworkProvider, SimpleIconsArtworkProvider, BrandArtworkProvider, GeneratedFallbackProvider } from './local-providers';
import { SteamGridDBArtworkProvider } from './steamgriddb';
import { IgdbArtworkProvider } from './igdb';
import { ActivityArtworkResolver } from './resolver';
import type { ArtworkStore } from './types';
export function createArtworkProviders(config: { STEAMGRIDDB_API_KEY?: string; IGDB_TWITCH_CLIENT_ID?: string; IGDB_TWITCH_CLIENT_SECRET?: string }) {
  return [new DiscordArtworkProvider(), new SteamGridDBArtworkProvider(config.STEAMGRIDDB_API_KEY), new IgdbArtworkProvider(config.IGDB_TWITCH_CLIENT_ID, config.IGDB_TWITCH_CLIENT_SECRET), new SimpleIconsArtworkProvider(), new BrandArtworkProvider(), new GeneratedFallbackProvider()];
}
export function createArtworkResolver(store: ArtworkStore, config: Parameters<typeof createArtworkProviders>[0]) {
  return new ActivityArtworkResolver(store, createArtworkProviders(config));
}
