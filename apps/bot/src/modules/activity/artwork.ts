import type { Activity } from 'discord.js';
import { artworkUrlSchema } from '@scrt/validation';
import type { ActivityArtwork } from '@scrt/shared';

/** Use the installed discord.js representation; never invent asset hashes or CDN paths. */
export function discordActivityArtwork(activity: Activity): ActivityArtwork['discord'] {
  const safe = (url: string | null | undefined) => {
    if (!url || !artworkUrlSchema.safeParse(url).success) return null;
    const parsed = new URL(url);
    if (!['cdn.discordapp.com', 'media.discordapp.net'].includes(parsed.hostname)) return null;
    // mp assets may be animated; Discord's documented media proxy converts to a static PNG.
    if (parsed.hostname === 'media.discordapp.net') parsed.searchParams.set('format', 'png');
    return parsed.toString();
  };
  try {
    return { iconUrl: safe(activity.assets?.smallImageURL({ extension: 'png', size: 64 }) ?? activity.assets?.largeImageURL({ extension: 'png', size: 64 })), heroUrl: safe(activity.assets?.largeImageURL({ extension: 'png', size: 1024 })) };
  } catch { return { iconUrl: null, heroUrl: null }; }
}
