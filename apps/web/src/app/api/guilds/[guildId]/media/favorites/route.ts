import { guildIdSchema, mediaFavoriteIdSchema, mediaFavoriteRequestSchema, mediaFavoritesPageSchema, mediaTrackSchema } from '@scrt/validation';
import { log } from '@scrt/shared';
import { requireGuildAccess } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { env, media } from '@/lib/server';
import { mediaInternal, MediaTransportError } from '@/lib/media-data';
import { mediaFailure, mediaJson, mediaRequestBody } from '@/lib/media-http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ guildId: string }> };
async function authorized(context: Context) {
  if (!await accessToken()) throw new MediaTransportError('Потрібен вхід.', 401);
  const guildId = guildIdSchema.parse((await context.params).guildId);
  const { user } = await requireGuildAccess(guildId, 'media.view');
  return { guildId, user };
}
export async function GET(request: Request, context: Context) {
  try {
    const { guildId } = await authorized(context);
    const cursor = new URL(request.url).searchParams.get('after');
    const page = await media().favorites(guildId, cursor ? mediaFavoriteIdSchema.parse(cursor) : undefined);
    return mediaJson(mediaFavoritesPageSchema.parse({ ...page, items: page.items.filter((item) => env().NODE_ENV !== 'production' || item.track.provider !== 'youtube') }));
  } catch (error) { return mediaFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { guildId, user } = await authorized(context);
    const action = mediaFavoriteRequestSchema.parse(await mediaRequestBody(request));
    if (action.liked && action.provider === 'youtube' && env().NODE_ENV === 'production') throw new MediaTransportError('YouTube тимчасово вимкнено на хостингу.', 422);
    const track = action.liked ? mediaTrackSchema.parse(await mediaInternal({ operation: 'track', guildId, actorUserId: user.id, provider: action.provider, providerItemId: action.providerItemId })) : undefined;
    const item = await media().setFavorite(guildId, action, { userId: user.id, name: user.global_name || user.username }, action.liked, track);
    log('info', 'media', 'favorites.updated', { guildId, actorId: user.id, provider: action.provider, liked: action.liked, favoriteId: item?.id ?? null, likes: item?.likedBy.length ?? 0 });
    return mediaJson({ item });
  } catch (error) { return mediaFailure(error); }
}
