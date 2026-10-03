import type { ActivityArtwork, ArtworkAsset, ArtworkIdentity, ArtworkMapping, ArtworkSource, ArtworkGalleryResult } from '@scrt/shared';

export type ArtworkLookupInput = ArtworkIdentity & {
  discord: ActivityArtwork['discord'];
  mapping: ArtworkMapping | null;
  classification: ActivityArtwork['classification'];
  needs: { icon: boolean; hero: boolean };
};
export type ArtworkProviderResult = {
  icon?: ArtworkAsset | null; logo?: ArtworkAsset | null; hero?: ArtworkAsset | null; cover?: ArtworkAsset | null;
  classification?: ActivityArtwork['classification']; resolvedName?: string; confidence: number; dominantColor?: string;
  failed?: boolean;
};
export type ProviderHealth = { status: 'available' | 'configured' | 'not_configured' | 'ok' | 'authorization_error' | 'rate_limited' | 'unavailable'; checkedAt: number };
export interface ActivityArtworkProvider {
  id: ArtworkSource;
  resolve(input: ArtworkLookupInput, signal: AbortSignal): Promise<ArtworkProviderResult | null>;
  health(): ProviderHealth;
  gallery?(input: ArtworkLookupInput, field: 'icon' | 'hero', page: number, signal: AbortSignal): Promise<ArtworkGalleryResult>;
}
export interface ArtworkStore {
  get(guildId: string, key: string): Promise<ActivityArtwork | null>;
  saveResolved(guildId: string, artwork: ActivityArtwork, expected: ActivityArtwork | null): Promise<ActivityArtwork | null>;
  saveProviderHealth(guildId: string, health: Record<string, ProviderHealth>): Promise<void>;
}
