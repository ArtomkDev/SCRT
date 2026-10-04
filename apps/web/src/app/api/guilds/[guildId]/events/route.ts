import { NextResponse } from 'next/server';
import { guildIdSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { liveStream } from '@/lib/live-stream';
import { voice } from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = guildIdSchema.safeParse((await context.params).guildId);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid guild ID' }, { status: 400 });
  const guildId = parsed.data;
  const scope = new URL(request.url).searchParams.get('scope') ?? 'voice';
  if (scope !== 'voice' && scope !== 'guild') return NextResponse.json({ error: 'Invalid event scope' }, { status: 400 });
  try {
    const { permissions } = await requireGuildAccess(guildId);
    return liveStream(request, (emit, fail) => voice().watchDashboard(guildId, scope === 'voice' && permissions.has('voice.view'), emit, fail), guildId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'Bot not installed') return NextResponse.json({ error: 'Bot not installed' }, { status: 409 });
    console.error('Guild change stream authorization failed', { guildId, error });
    return NextResponse.json({ error: 'Guild unavailable' }, { status: 503 });
  }
}
