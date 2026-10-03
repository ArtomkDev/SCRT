import { z } from 'zod';
import { activityGameKeySchema } from './activity';

/** Browser-only remote images: never download/proxy administrator URLs. Reject network literals and local names too. */
export const artworkUrlSchema = z.string().trim().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && host.includes('.') && !host.includes(':') && !/^[\d.]+$/u.test(host)
      && !/(^|\.)(localhost|local|internal|lan|home|invalid|test)$/u.test(host)
      && host !== 'metadata.google.internal' && !/\.(gif|apng)$/iu.test(url.pathname);
  } catch { return false; }
}, 'Вкажіть HTTPS URL зображення на публічному домені.');
export const artworkMappingSchema = z.object({ provider: z.enum(['steamgriddb', 'igdb']), entityId: z.string().regex(/^[1-9]\d{0,11}$/u) });
export const uploadedArtworkUrlSchema = z.string().regex(/^\/servers\/\d{17,20}\/activity\/artwork\/[a-f0-9]{64}$/u);
const storedUrl = z.union([artworkUrlSchema, uploadedArtworkUrlSchema, z.string().max(24000).regex(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/u)]);
export const artworkOverridesSchema = z.object({ iconUrl: storedUrl.nullable(), heroUrl: storedUrl.nullable() });
const source = z.enum(['discord', 'steamgriddb', 'igdb', 'simple-icons', 'brand', 'generated', 'manual']);
export const artworkAssetSchema = z.object({
  url: storedUrl,
  source, kind: z.enum(['icon', 'logo', 'cover', 'hero']), entityId: z.string().max(128).nullable(), attributionUrl: artworkUrlSchema.nullable(),
});
export const activityArtworkSchema = z.object({
  gameKey: activityGameKeySchema, observedName: z.string().min(1).max(128), classification: z.enum(['game', 'application', 'unknown']),
  icon: artworkAssetSchema.nullable(), logo: artworkAssetSchema.nullable(), hero: artworkAssetSchema.nullable(), cover: artworkAssetSchema.nullable(),
  dominantColor: z.string().regex(/^#[a-f\d]{6}$/iu).nullable(), resolvedName: z.string().max(128).nullable(), confidence: z.number().min(0).max(1),
  status: z.enum(['resolved', 'not_found', 'error']), resolvedAt: z.number().int().nonnegative(), nextRefreshAt: z.number().int().nonnegative(),
  resolutionVersion: z.string().max(256).default('legacy'),
  overrides: artworkOverridesSchema, selections: z.object({ icon: artworkAssetSchema.nullable(), hero: artworkAssetSchema.nullable() }).default({ icon: null, hero: null }), mapping: artworkMappingSchema.nullable(), discord: z.object({ iconUrl: artworkUrlSchema.nullable(), heroUrl: artworkUrlSchema.nullable() }), schemaVersion: z.literal(1), revision: z.number().int().nonnegative().default(0),
});
export const artworkIdentitySchema = z.object({ gameKey: activityGameKeySchema, displayName: z.string().min(1).max(128), applicationId: z.string().regex(/^\d{17,20}$/u).nullable() });
