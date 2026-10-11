import { guildIdSchema, mediaFavoriteIdSchema, mediaFavoritePlaylistRequestSchema, mediaFavoritePlaylistsPageSchema, mediaPlaylistPageSchema } from '@scrt/validation';
import { log } from '@scrt/shared';
import { requireGuildAccess } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { media } from '@/lib/server';
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
    return mediaJson(mediaFavoritePlaylistsPageSchema.parse(await media().favoritePlaylists(guildId, cursor ? mediaFavoriteIdSchema.parse(cursor) : undefined)));
  } catch (error) { return mediaFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { guildId, user } = await authorized(context);
    const action = mediaFavoritePlaylistRequestSchema.parse(await mediaRequestBody(request));
    const playlist = action.liked ? mediaPlaylistPageSchema.parse(await mediaInternal({ operation: 'playlist', guildId, actorUserId: user.id, providerItemId: action.providerItemId })).playlist : undefined;
    const item = await media().setFavoritePlaylist(guildId, action.providerItemId, { userId: user.id, name: user.global_name || user.username }, action.liked, playlist);
    log('info', 'media', 'playlist.favorite_updated', { guildId, actorId: user.id, liked: action.liked, favoriteId: item?.id ?? null, likes: item?.likedBy.length ?? 0 });
    return mediaJson({ item });
  } catch (error) { return mediaFailure(error); }
}
