import { requireGuildAccess } from '@/lib/guards';
import { activityArtworkStore } from '@/lib/server';

export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string; imageId: string }> }) {
  const { guildId, imageId } = await params;
  await requireGuildAccess(guildId, 'activity.view');
  const bytes = await activityArtworkStore().upload(guildId, imageId);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Content-Length': String(bytes.length) } });
}
