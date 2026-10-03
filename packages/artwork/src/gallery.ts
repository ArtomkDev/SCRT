import type { ArtworkGallerySource } from '@scrt/shared';
import type { ActivityArtworkProvider, ArtworkLookupInput } from './types';

/** Explicit administrator lookup: every source is queried, independently of automatic priority. */
export async function providerGallery(provider: ActivityArtworkProvider, input: ArtworkLookupInput, field: 'icon' | 'hero', page = 0): Promise<ArtworkGallerySource> {
  const empty = { source: provider.id, assets: [], games: [], nextPage: null };
  if (provider.health().status === 'not_configured') return { ...empty, status: 'not_configured' };
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      provider.gallery ? provider.gallery(input, field, page, controller.signal) : provider.resolve(input, controller.signal).then((value) => {
        const asset = field === 'hero' ? value?.hero : value?.icon ?? value?.logo ?? value?.cover;
        return { assets: asset ? [{ asset, title: value?.resolvedName ?? input.displayName, previewUrl: asset.url }] : [], games: [], nextPage: null, failed: value?.failed };
      }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Artwork gallery timeout')); }, 12_000); }),
    ]);
    return { ...result, source: provider.id, status: result.failed ? 'error' : result.assets.length ? 'ok' : 'not_found' };
  } catch { return { ...empty, status: 'error' }; }
  finally { clearTimeout(timer); }
}
