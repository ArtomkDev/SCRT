import { NextResponse } from 'next/server';
import { manageableGuilds } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { liveStream } from '@/lib/live-stream';
import { guilds } from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!await accessToken()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const ids = (await manageableGuilds()).map((guild) => guild.id);
    return liveStream(request, (emit, fail) => guilds().watchInstalledGuilds(ids, emit, fail), 'servers');
  } catch (error) {
    console.error('Server list change stream authorization failed', { error });
    return NextResponse.json({ error: 'Servers unavailable' }, { status: 503 });
  }
}
