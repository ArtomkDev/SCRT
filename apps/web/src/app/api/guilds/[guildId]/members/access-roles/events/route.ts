import { NextResponse } from 'next/server';
import { guildIdSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { liveStream } from '@/lib/live-stream';
import { scopeDirectoryEvent } from '@/lib/member-directory-scope';
import { accessToken } from '@/lib/session';
import { guilds } from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = guildIdSchema.safeParse((await context.params).guildId);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid guild ID' }, { status: 400 });
  const guildId = parsed.data;
  try {
    await requireGuildAccess(guildId, 'settings.view');
    const mappings = await guilds().accessMappings(guildId);
    const mappedRoles = new Set(mappings.roles.map((entry) => entry.discordRoleId));
    return liveStream(request, (emit, fail) => guilds().watchMemberChanges(guildId, (event) => emit(JSON.stringify(scopeDirectoryEvent(guildId, event, mappedRoles))), fail), `access-role-members:${guildId}`, 60_000);
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'Bot not installed') return NextResponse.json({ error: 'Bot not installed' }, { status: 409 });
    console.error('Access-role member stream authorization failed', { guildId, error });
    return NextResponse.json({ error: 'Role members unavailable' }, { status: 503 });
  }
}
