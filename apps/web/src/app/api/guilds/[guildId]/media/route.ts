import { guildIdSchema, mediaCommandResultSchema, mediaHistoryDeleteSchema, mediaHistoryPageSchema, mediaRequestSchema, mediaSettingsSchema, mediaSearchResultSchema, mediaPlaylistReferenceSchema, mediaPlaylistPageSchema, type MediaInternalRequest } from '@scrt/validation';
import { z } from 'zod';
import { requireGuildAccess, requireSession } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { media } from '@/lib/server';
import { mediaInternal, mediaSnapshot, MediaTransportError } from '@/lib/media-data';
import { mediaFailure as failure, mediaJson as json, mediaRequestBody as body } from '@/lib/media-http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ guildId: string }> };
async function authorized(context: Context) {
  if (!await accessToken()) throw new MediaTransportError('Потрібен вхід.', 401);
  const guildId = guildIdSchema.parse((await context.params).guildId);
  const { user } = await requireSession(`/servers/${guildId}/media`);
  // The worker checks live membership, permissions and Voice for every operation.
  // Do not perform the same Discord/Firestore authorization and state reads twice.
  return { guildId, user };
}
export async function GET(request: Request, context: Context) {
  try {
    const { guildId, user } = await authorized(context); const search = new URL(request.url).searchParams;
    if (search.has('playlist')) {
      const providerItemId = mediaPlaylistReferenceSchema.parse(search.get('playlist'));
      const page = search.has('page') ? z.coerce.number().int().min(0).max(9).parse(search.get('page')) : undefined;
      return json(mediaPlaylistPageSchema.parse(await mediaInternal({ operation: 'playlist', guildId, actorUserId: user.id, providerItemId, ...(page !== undefined ? { page } : {}) })));
    }
    if (search.has('q')) {
      const query = z.string().trim().min(2).max(250).parse(search.get('q'));
      const page = search.has('page') ? z.coerce.number().int().min(0).max(9).parse(search.get('page')) : undefined;
      const value = await mediaInternal({ operation: 'search', guildId, actorUserId: user.id, query, ...(page !== undefined ? { page } : {}) });
      return json(mediaSearchResultSchema.parse(value));
    }
    if (search.has('history')) { await requireGuildAccess(guildId, 'media.view'); const before = search.has('before') ? z.coerce.number().int().positive().parse(search.get('before')) : Date.now(); const beforeId = search.has('beforeId') ? z.uuid().parse(search.get('beforeId')) : undefined; return json(mediaHistoryPageSchema.parse(await media().history(guildId, before, 25, beforeId))); }
    return json(await mediaSnapshot(guildId, user.id));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { guildId, user } = await authorized(context); const command = mediaRequestSchema.parse(await body(request));
    const internal: MediaInternalRequest = { operation: 'command', command: { ...command, guildId, actorUserId: user.id } };
    return json(mediaCommandResultSchema.parse(await mediaInternal(internal)));
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { const { guildId, user } = await authorized(context); const settings = mediaSettingsSchema.parse(await body(request)); return json(mediaSettingsSchema.parse(await mediaInternal({ operation: 'settings', guildId, actorUserId: user.id, settings }))); }
  catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const { guildId, user } = await authorized(context);
    const action = mediaHistoryDeleteSchema.parse(await body(request));
    await requireGuildAccess(guildId, 'media.view');
    if (action.type === 'CLEAR_OWN') return json(await media().clearOwnHistory(guildId, user.id));
    const result = await media().deleteHistoryItem(guildId, action.id, user.id);
    if (result === 'forbidden') throw new MediaTransportError('Можна видаляти лише власні записи історії.', 403);
    return json({ deleted: result === 'deleted' ? 1 : 0, more: false });
  } catch (error) { return failure(error); }
}
