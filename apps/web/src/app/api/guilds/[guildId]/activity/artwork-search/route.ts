import { z } from 'zod';
import { activityGameKeySchema, guildIdSchema } from '@scrt/validation';
import type { ArtworkSearchUpdate } from '@scrt/shared';
import { requireGuildAccess } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { artworkGallery, artworkGalleryContext } from '@/lib/artwork-gallery';
import { signArtworkSelection } from '@/lib/artwork-selection';
import { env } from '@/lib/server';

const searchSchema = z.object({
  gameKey: activityGameKeySchema, source: z.enum(['discord', 'steamgriddb', 'igdb', 'simple-icons', 'brand']),
  field: z.enum(['icon', 'hero', 'both']).default('both'), query: z.string().trim().min(1).max(128),
  entityId: z.string().regex(/^[1-9]\d{0,11}$/u).optional(), page: z.coerce.number().int().min(0).max(100).default(0),
});
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return Response.json({ error: 'Потрібен вхід.' }, { status: 401 });
  const guild = guildIdSchema.safeParse((await params).guildId);
  const parsed = searchSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!guild.success || !parsed.success) return Response.json({ error: 'Некоректний пошук.' }, { status: 400 });
  const guildId = guild.data; const input = parsed.data;
  try {
    await requireGuildAccess(guildId, 'activity.manage');
    const context = await artworkGalleryContext(guildId, input.gameKey);
    const fields: Array<'icon' | 'hero'> = input.field === 'both' ? ['icon', 'hero'] : [input.field];
    const encoder = new TextEncoder(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (update: ArtworkSearchUpdate) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(update) + '\n')); };
        void Promise.all(fields.map(async (field) => {
          try {
            const result = await artworkGallery(guildId, input.gameKey, input.source, field, input.query, input.entityId, input.page, context);
            send({ field, result: { ...result, assets: result.assets.map((candidate) => ({ ...candidate, token: signArtworkSelection(env().SESSION_SECRET, guildId, input.gameKey, field, candidate.asset) })) } });
          } catch { send({ field, error: 'Не вдалося завершити пошук. Спробуйте ще раз.' }); }
        })).finally(() => { if (!cancelled) controller.close(); });
      },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === 'Forbidden';
    return Response.json({ error: forbidden ? 'Недостатньо прав.' : 'Пошук тимчасово недоступний.' }, { status: forbidden ? 403 : 503 });
  }
}
