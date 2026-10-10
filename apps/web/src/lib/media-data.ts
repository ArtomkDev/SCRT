import 'server-only';
import { cache } from 'react';
import { mediaInternalRequestSchema, mediaSnapshotSchema, type MediaInternalRequest, type MediaSnapshot } from '@scrt/validation';
import { log } from '@scrt/shared';
import { env, media } from './server';
export class MediaTransportError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function mediaConfigurationError(): string | null {
  const config = env();
  const missing = (['MEDIA_INTERNAL_SECRET', 'MEDIA_BOT_URL'] as const).filter((key) => !config[key]);
  return missing.length ? `Не налаштовано ${missing.join(' та ')}. Налаштуйте канал web ↔ bot, щоб зберігати налаштування й керувати Медіа.` : null;
}
export async function mediaInternal(input: MediaInternalRequest): Promise<unknown> {
  const config = env(); const configurationError = mediaConfigurationError();
  if (configurationError || !config.MEDIA_BOT_URL || !config.MEDIA_INTERNAL_SECRET) throw new MediaTransportError(configurationError ?? 'Канал web ↔ bot не налаштовано.', 503);
  let response: Response;
  const timeoutMs = input.operation === 'state' ? 8000 : input.operation === 'search' ? 25000 : input.operation === 'settings' ? 15000 : 55000;
  const parsed = mediaInternalRequestSchema.parse(input); const startedAt = Date.now();
  const diagnostic = { requestId: globalThis.crypto.randomUUID(), operation: input.operation, guildId: input.operation === 'command' ? input.command.guildId : input.guildId, timeoutMs };
  if (input.operation !== 'state') log('info', 'media', 'worker.request.started', diagnostic);
  try { response = await fetch(new URL('/internal/media', config.MEDIA_BOT_URL), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.MEDIA_INTERNAL_SECRET}`, 'X-SCRT-Request': diagnostic.requestId }, body: JSON.stringify(parsed), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) {
    const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    log('error', 'media', 'worker.request.failed', { ...diagnostic, durationMs: Date.now() - startedAt, timedOut }, error);
    throw new MediaTransportError(timedOut ? 'Media API не відповів у відведений час. Подробиці запиту записано в логах.' : 'Не вдалося підключитися до Media API. Перевірте MEDIA_BOT_URL і запустіть або перезапустіть бота.', 503);
  }
  if (input.operation !== 'state' || !response.ok) log(response.ok ? 'info' : 'error', 'media', 'worker.request.completed', { ...diagnostic, status: response.status, durationMs: Date.now() - startedAt });
  const value: unknown = await response.json().catch(() => null);
  if (response.status === 401) throw new MediaTransportError('Media API відхилив ключ доступу. MEDIA_INTERNAL_SECRET має бути однаковим у вебі та боті; після зміни перезапустіть обидва.', 401);
  if (!response.ok) throw new MediaTransportError(typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string' ? value.error.slice(0, 400) : 'Помилка Media worker.', [400, 401, 403, 409, 413, 422, 429, 503].includes(response.status) ? response.status : 503);
  return value;
}
export const mediaSnapshot = cache(async (guildId: string, actorUserId: string) => mediaSnapshotSchema.parse(await mediaInternal({ operation: 'state', guildId, actorUserId })));
export const mediaSettings = cache((guildId: string) => media().getSettings(guildId));
export async function initialMediaSnapshot(guildId: string, userId: string): Promise<{ snapshot: MediaSnapshot; unavailable: string | null }> {
  try { return { snapshot: await mediaSnapshot(guildId, userId), unavailable: null }; }
  catch (error) {
    const settings = await mediaSettings(guildId); const session = await media().getSession(guildId);
    const reason = error instanceof MediaTransportError ? error.message : 'Media worker недоступний.';
    return { snapshot: { settings, session, controls: {}, queueControls: {}, actorVoice: { id: null, name: null }, remoteControl: false, listenerCount: 0, votes: { count: 0, required: 1 }, providers: [], engine: { available: false, ffmpeg: false, opus: false, dave: false }, serverTimestamp: Date.now(), canManage: false }, unavailable: `${reason} Показано останній збережений стан.` };
  }
}
