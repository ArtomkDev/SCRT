import { isRuntimeLogAdmin } from '@scrt/permissions';
import { runtimeLogSnapshot } from '@scrt/shared';
import { runtimeLogSnapshotSchema, runtimeLogCursorSchema } from '@scrt/validation';
import { sessionUser } from '@/lib/session';
import { env } from '@/lib/server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const user = await sessionUser();
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401, headers });
  if (!isRuntimeLogAdmin(user.id)) return Response.json({ error: 'Доступ заборонено.' }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const webCursor = runtimeLogCursorSchema.safeParse({ runId: params.get('webRun') ?? '', after: params.get('webAfter') ?? 0 });
  const botCursor = runtimeLogCursorSchema.safeParse({ runId: params.get('botRun') ?? '', after: params.get('botAfter') ?? 0 });
  if (!webCursor.success || !botCursor.success) return Response.json({ error: 'Некоректний курсор.' }, { status: 400, headers });
  let bot = null; let botError: string | null = null;
  const config = env();
  try {
    if (!config.MEDIA_BOT_URL || !config.MEDIA_INTERNAL_SECRET) throw new Error('Канал web ↔ bot не налаштовано.');
    const url = new URL('/internal/logs', config.MEDIA_BOT_URL);
    url.searchParams.set('runId', botCursor.data.runId); url.searchParams.set('after', String(botCursor.data.after));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.MEDIA_INTERNAL_SECRET}`, 'X-SCRT-Actor': user.id },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Бот повернув HTTP ${response.status}.`);
    bot = runtimeLogSnapshotSchema.parse(await response.json());
  } catch { botError = 'Логи бота недоступні. Перевірте запуск бота та канал web ↔ bot.'; }
  return Response.json({ web: runtimeLogSnapshot(webCursor.data), bot, botError }, { headers });
}
