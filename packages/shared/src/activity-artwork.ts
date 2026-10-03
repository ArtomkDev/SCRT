export type ArtworkSource = 'discord' | 'steamgriddb' | 'igdb' | 'simple-icons' | 'brand' | 'generated' | 'manual';
export type ArtworkAsset = { url: string; source: ArtworkSource; kind: 'icon' | 'logo' | 'cover' | 'hero'; entityId: string | null; attributionUrl: string | null };
export type ArtworkMapping = { provider: 'steamgriddb' | 'igdb'; entityId: string };
export type ArtworkIdentity = { gameKey: string; displayName: string; applicationId: string | null };
export type ActivityArtwork = {
  gameKey: string;
  observedName: string;
  classification: 'game' | 'application' | 'unknown';
  icon: ArtworkAsset | null;
  logo: ArtworkAsset | null;
  hero: ArtworkAsset | null;
  cover: ArtworkAsset | null;
  dominantColor: string | null;
  resolvedName: string | null;
  confidence: number;
  status: 'resolved' | 'not_found' | 'error';
  resolvedAt: number;
  nextRefreshAt: number;
  overrides: { iconUrl: string | null; heroUrl: string | null };
  selections?: { icon: ArtworkAsset | null; hero: ArtworkAsset | null };
  mapping: ArtworkMapping | null;
  discord: { iconUrl: string | null; heroUrl: string | null };
  schemaVersion: 1;
  revision: number;
  resolutionVersion?: string;
};

/** Stable CSS identity; never writes files or changes Activity identity. */
export function artworkIdentity(gameKey: string, name: string) {
  let hash = 2166136261;
  for (const char of gameKey) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  const words = name.normalize('NFKC').replace(/([a-z])([A-Z])/gu, '$1 $2').match(/[\p{L}\p{N}]+/gu) ?? ['?'];
  const initials = (words.length > 1 ? words[0]!.slice(0, 1) + words[1]!.slice(0, 1) : words[0]!.slice(0, 2)).toLocaleUpperCase('uk-UA');
  return { initials, background: `hsl(${(hash >>> 0) % 360} 45% 24%)`, accent: `hsl(${(hash >>> 0) % 360} 55% 38%)` };
}

export function effectiveArtwork(artwork: ActivityArtwork | null | undefined, field: 'icon' | 'hero'): ArtworkAsset | null {
  const override = artwork?.overrides[field === 'icon' ? 'iconUrl' : 'heroUrl'];
  if (override && artwork?.selections?.[field]?.url === override) return artwork.selections[field];
  return override ? { url: override, source: 'manual', kind: field, entityId: null, attributionUrl: null } : artwork?.[field] ?? null;
}

export type ArtworkGalleryCandidate = { asset: ArtworkAsset; title: string; previewUrl: string };
export type ArtworkGalleryResult = {
  assets: ArtworkGalleryCandidate[];
  games: Array<{ id: string; name: string }>;
  nextPage: number | null;
  failed?: boolean;
};
export type ArtworkGallerySource = ArtworkGalleryResult & {
  source: ArtworkSource;
  status: 'ok' | 'not_found' | 'not_configured' | 'error';
};
export type SignedArtworkGallery = Omit<ArtworkGallerySource, 'assets'> & { assets: Array<ArtworkGalleryCandidate & { token: string }> };
export type ArtworkSearchUpdate = { field: 'icon' | 'hero'; result?: SignedArtworkGallery; error?: string };
