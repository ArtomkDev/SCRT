import { NextResponse } from 'next/server';
import { directoryMember, DiscordApiError } from '@scrt/discord';
import { guildIdSchema, snowflakeSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { cachedGuildMemberPage } from '@/lib/member-directory-cache';
import { accessRoleMember } from '@/lib/member-directory-scope';
import { accessToken } from '@/lib/session';
import { env, guilds } from '@/lib/server';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = guildIdSchema.safeParse((await context.params).guildId);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid guild ID' }, { status: 400 });
  const guildId = parsed.data;
  const url = new URL(request.url);
  const after = url.searchParams.get('after');
  if (after && !snowflakeSchema.safeParse(after).success) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  try {
    await requireGuildAccess(guildId, 'settings.view');
    const [mappings, revision] = await Promise.all([guilds().accessMappings(guildId), guilds().memberDirectoryRevision(guildId)]);
    if (url.searchParams.get('revision') === '1') return NextResponse.json({ revision }, { headers: { 'Cache-Control': 'private, no-store' } });
    const mappedRoles = new Set(mappings.roles.map((entry) => entry.discordRoleId));
    if (!mappedRoles.size) return NextResponse.json({ members: [], nextAfter: null, revision: after ? undefined : revision }, { headers: { 'Cache-Control': 'private, no-store' } });
    const page = await cachedGuildMemberPage(env().DISCORD_BOT_TOKEN, guildId, revision, after ?? undefined);
    const members = page.filter((member) => !member.user.bot)
      .map((member) => accessRoleMember(guildId, directoryMember(guildId, member), mappedRoles))
      .filter((member) => member !== null);
    return NextResponse.json({ members, nextAfter: page.length === 1000 ? page.at(-1)?.user.id : null, revision: after ? undefined : revision }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'Bot not installed') return NextResponse.json({ error: 'Bot not installed' }, { status: 409 });
    if (error instanceof DiscordApiError && error.status === 403) return NextResponse.json({ error: 'Guild Members Intent required' }, { status: 409 });
    console.error('Access-role member directory request failed', { guildId, error });
    return NextResponse.json({ error: 'Role members unavailable' }, { status: 503 });
  }
}
