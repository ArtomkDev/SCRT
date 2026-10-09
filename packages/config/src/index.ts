import { z } from 'zod';

const nonempty = z.string().min(1);
const firebase = { FIREBASE_PROJECT_ID: nonempty, FIREBASE_CLIENT_EMAIL: z.email(), FIREBASE_PRIVATE_KEY: nonempty };
const discord = { DISCORD_CLIENT_ID: nonempty, DISCORD_CLIENT_SECRET: nonempty };
const base = { NODE_ENV: z.enum(['development', 'test', 'production']).default('development') };
const optionalCredential = z.string().trim().max(512).optional().transform((value) => value || undefined);
const artwork = { STEAMGRIDDB_API_KEY: optionalCredential, IGDB_TWITCH_CLIENT_ID: optionalCredential, IGDB_TWITCH_CLIENT_SECRET: optionalCredential };
const mediaSecret = z.string().max(512).optional().transform((v) => v || undefined).pipe(z.string().min(32).optional());
const mediaShared = { MEDIA_INTERNAL_SECRET: mediaSecret };
const mediaProviders = { SPOTIFY_CLIENT_ID: optionalCredential, SPOTIFY_CLIENT_SECRET: optionalCredential, YOUTUBE_API_KEY: optionalCredential,
  MEDIA_RADIO_CATALOG_JSON: z.string().max(100000).optional(), MEDIA_FFMPEG_PATH: z.string().max(1024).optional() };
const appOrigin = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}, 'Expected an HTTP(S) origin without credentials, path, query or fragment');
const mediaBotOrigin = appOrigin.refine((value) => { const url = new URL(value); return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.railway.internal'); }, 'Use HTTPS for public Media endpoints; HTTP is limited to loopback or Railway private networking');
export const botEnvSchema = z.object({ ...base, ...artwork, ...mediaShared, ...mediaProviders, ...firebase, DISCORD_BOT_TOKEN: nonempty, DISCORD_CLIENT_ID: nonempty, DISCORD_GUILD_ID: z.string().optional(), DISCORD_GUILD_MEMBERS_INTENT: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'), MEDIA_INTERNAL_HOST: z.string().default('127.0.0.1'), MEDIA_INTERNAL_PORT: z.coerce.number().int().min(1).max(65535).default(3100) });
export const webEnvSchema = z.object({ ...base, ...artwork, ...mediaShared, ...firebase, ...discord, NEXT_PUBLIC_APP_URL: appOrigin, SESSION_SECRET: z.string().min(32), DISCORD_BOT_TOKEN: nonempty, MEDIA_BOT_URL: z.union([mediaBotOrigin, z.literal('')]).optional().transform((v) => v || undefined) }).refine((value) => !value.MEDIA_INTERNAL_SECRET || value.MEDIA_INTERNAL_SECRET !== value.SESSION_SECRET, 'Use a separate Media internal secret');

export function parseEnvironment<T extends z.ZodType>(schema: T, source: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new Error(`Invalid environment: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
}
export function botEnv() { return parseEnvironment(botEnvSchema, process.env); }
export function webEnv() { return parseEnvironment(webEnvSchema, process.env); }
