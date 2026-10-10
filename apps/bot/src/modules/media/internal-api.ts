import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mediaInternalRequestSchema, runtimeLogCursorSchema } from '@scrt/validation';
import { log, runtimeLogSnapshot, type LogContext } from '@scrt/shared';
import { isRuntimeLogAdmin } from '@scrt/permissions';
import { MediaSourceError } from '@scrt/media';
import { MediaError, type MediaCommandService } from './command-service';

export function mediaInternalAuthorized(header: string | undefined, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`); const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function startMediaInternalApi(commands: MediaCommandService, config: { secret: string; host: string; port: number }): Promise<Server> {
  if (config.secret.length < 32) return Promise.reject(new Error('Media internal secret must contain at least 32 characters'));
  const windows = new Map<string, { since: number; count: number }>(); let inflight = 0;
  const server = createServer(async (request, response) => {
    const startedAt = Date.now(); let diagnostic: LogContext | null = null;
    const reply = (status: number, body: unknown) => {
      if (!response.headersSent) {
        if (diagnostic && (diagnostic.operation !== 'state' || status >= 400)) log(status >= 400 ? 'error' : 'info', 'media', 'internal.request.completed', { ...diagnostic, status, durationMs: Date.now() - startedAt });
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body));
      }
    };
    response.once('close', () => { if (diagnostic && !response.writableEnded) log('warn', 'media', 'internal.client.disconnected', { ...diagnostic, durationMs: Date.now() - startedAt }); });
    const [pathname, query] = (request.url ?? '/').split('?');
    if (request.method === 'GET' && pathname === '/internal/logs') {
      if (!mediaInternalAuthorized(request.headers.authorization, config.secret)) { reply(401, { error: 'Unauthorized' }); return; }
      const actor = request.headers['x-scrt-actor'];
      if (typeof actor !== 'string' || !isRuntimeLogAdmin(actor)) { reply(403, { error: 'Forbidden' }); return; }
      const cursor = runtimeLogCursorSchema.safeParse(Object.fromEntries(new URLSearchParams(query)));
      if (!cursor.success) { reply(400, { error: 'Invalid cursor' }); return; }
      reply(200, runtimeLogSnapshot(cursor.data)); return;
    }
    if (request.method !== 'POST' || request.url !== '/internal/media') { reply(404, { error: 'Not found' }); return; }
    if (!mediaInternalAuthorized(request.headers.authorization, config.secret)) { reply(401, { error: 'Unauthorized' }); return; }
    if (inflight >= 32) { reply(429, { error: 'Media worker зайнятий.' }); return; }
    inflight++;
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new MediaError('Запит завеликий.', 413); chunks.push(Buffer.from(chunk)); }
      const value = mediaInternalRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!value.success) throw new MediaError('Некоректний запит Медіа.', 400);
      const input = value.data; const guildId = input.operation === 'command' ? input.command.guildId : input.guildId;
      const userId = input.operation === 'command' ? input.command.actorUserId : input.actorUserId;
      const correlation = request.headers['x-scrt-request'];
      const requestId = typeof correlation === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlation) ? correlation : globalThis.crypto.randomUUID();
      diagnostic = { requestId, guildId, actorId: userId, operation: input.operation };
      if (input.operation !== 'state') log('info', 'media', 'internal.request.started', diagnostic);
      const key = `${guildId}:${userId}:${input.operation}`; const now = Date.now(); const previous = windows.get(key); const window = previous && now - previous.since < 60000 ? previous : { since: now, count: 0 };
      window.count++; if (windows.size >= 5000) for (const [id, entry] of windows) if (now - entry.since >= 60000) windows.delete(id);
      if (!windows.has(key) && windows.size >= 5000) throw new MediaError('Media worker зайнятий.', 429);
      windows.set(key, window); if (window.count > (input.operation === 'search' ? 12 : 120)) throw new MediaError('Забагато запитів. Зачекайте хвилину.', 429);
      const sessions = commands.sessions;
      const result = input.operation === 'state' ? await sessions.state(guildId, userId)
        : input.operation === 'search' ? await sessions.search(guildId, userId, input.query, input.page)
        : input.operation === 'settings' ? await sessions.settings(guildId, userId, input.settings)
        : await commands.execute(input.command);
      reply(200, result);
    } catch (error) {
      if (error instanceof MediaError) reply(error.status, { error: error.message });
      else if (error instanceof MediaSourceError) reply(422, { error: error.message });
      else if (error instanceof SyntaxError) reply(400, { error: 'Invalid JSON' });
      else { log('error', 'media', 'internal.request.failed', diagnostic ?? {}, error); reply(503, { error: 'Media worker тимчасово недоступний.' }); }
    } finally { inflight--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, () => { server.removeListener('error', reject); server.on('error', (error) => log('error', 'media', 'internal.server.failed', {}, error)); resolve(server); }); });
}
