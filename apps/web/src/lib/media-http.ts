import 'server-only';
import { z } from 'zod';
import { log } from '@scrt/shared';
import { env } from './server';
import { MediaTransportError } from './media-data';

export const mediaJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
export function mediaFailure(error: unknown) {
  if (error instanceof MediaTransportError) return mediaJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return mediaJson({ error: 'Некоректний запит Медіа.' }, 400);
  if (error instanceof Error && error.message === 'Forbidden') return mediaJson({ error: 'Недостатньо прав.' }, 403);
  log('warn', 'media', 'web.request.failed', {}, error);
  return mediaJson({ error: 'Медіа тимчасово недоступне.' }, 503);
}
export async function mediaRequestBody(request: Request): Promise<unknown> {
  if (request.headers.get('origin') !== new URL(env().NEXT_PUBLIC_APP_URL).origin || !request.headers.get('content-type')?.startsWith('application/json')) throw new MediaTransportError('Недозволене джерело запиту.', 403);
  const reader = request.body?.getReader(); if (!reader) throw new MediaTransportError('Порожній запит.', 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) throw new MediaTransportError('Запит завеликий.', 413); chunks.push(value); } }
  finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
