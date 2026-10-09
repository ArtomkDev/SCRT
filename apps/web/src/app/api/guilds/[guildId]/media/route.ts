import { guildIdSchema, mediaCommandResultSchema, mediaHistoryDeleteSchema, mediaHistoryPageSchema, mediaRequestSchema, mediaSettingsSchema, mediaSearchResultSchema, type MediaInternalRequest } from '@scrt/validation';
import { z } from 'zod';
import { requireGuildAccess, requireSession } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { env, media } from '@/lib/server';
import { mediaInternal, mediaSnapshot, MediaTransportError } from '@/lib/media-data';
import { log } from '@scrt/shared';

export const runtime = 'nodejs';
type Context = { params: Promise<{ guildId: string }> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function authorized(context: Context) {
  if (!await accessToken()) throw new MediaTransportError('Потрібен вхід.', 401);
  const guildId = guildIdSchema.parse((await context.params).guildId);
  const { user } = await requireSession(`/servers/${guildId}/media`);
  // The worker checks live membership, permissions and Voice for every operation.
  // Do not perform the same Discord/Firestore authorization and state reads twice.
  return { guildId, user };
}
function failure(error: unknown) {
  if (error instanceof MediaTransportError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: 'Некоректний запит Медіа.' }, 400);
  if (error instanceof Error && error.message === 'Forbidden') return json({ error: 'Недостатньо прав.' }, 403);
  log('warn', 'media', 'web.request.failed', {}, error); return json({ error: 'Медіа тимчасово недоступне.' }, 503);
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('origin') !== new URL(env().NEXT_PUBLIC_APP_URL).origin || !request.headers.get('content-type')?.startsWith('application/json')) throw new MediaTransportError('Недозволене джерело запиту.', 403);
  const reader = request.body?.getReader(); if (!reader) throw new MediaTransportError('Порожній запит.', 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) throw new MediaTransportError('Запит завеликий.', 413); chunks.push(value); } }
  finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function GET(request: Request, context: Context) {
  try {
    const { guildId, user } = await authorized(context); const search = new URL(request.url).searchParams;
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
