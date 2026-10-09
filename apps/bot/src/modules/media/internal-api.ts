import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mediaInternalRequestSchema } from '@scrt/validation';
import { log } from '@scrt/shared';
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
    const reply = (status: number, body: unknown) => { if (!response.headersSent) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); } };
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
      else { log('error', 'media', 'internal.request.failed', {}, error); reply(503, { error: 'Media worker тимчасово недоступний.' }); }
    } finally { inflight--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, () => { server.removeListener('error', reject); server.on('error', (error) => log('error', 'media', 'internal.server.failed', {}, error)); resolve(server); }); });
}
