import { NextResponse } from 'next/server';
import { botGuildMember, botSearchGuildMembers, directoryMember, DiscordApiError } from '@scrt/discord';
import { guildIdSchema, snowflakeSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { env, guilds } from '@/lib/server';
import { cachedGuildMemberPage } from '@/lib/member-directory-cache';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = guildIdSchema.safeParse((await context.params).guildId);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid guild ID' }, { status: 400 });
  const guildId = parsed.data;
  const url = new URL(request.url);
  const after = url.searchParams.get('after');
  const query = url.searchParams.get('query')?.trim();
  const revisionOnly = url.searchParams.get('revision') === '1';
  if (after && !snowflakeSchema.safeParse(after).success) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  if (query !== undefined && (query.length < 2 || query.length > 50)) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  try {
    await requireGuildAccess(guildId, 'settings.manage');
    if (revisionOnly) return NextResponse.json({ revision: await guilds().memberDirectoryRevision(guildId) }, { headers: { 'Cache-Control': 'private, no-store' } });
    const token = env().DISCORD_BOT_TOKEN;
    if (query !== undefined) {
      let found: Awaited<ReturnType<typeof botSearchGuildMembers>>;
      if (snowflakeSchema.safeParse(query).success) {
        try { found = [await botGuildMember(token, guildId, query)]; }
        catch (error) { if (error instanceof DiscordApiError && error.status === 404) found = []; else throw error; }
      } else found = await botSearchGuildMembers(token, guildId, query);
      return NextResponse.json({ members: found.filter((member) => !member.user.bot).map((member) => directoryMember(guildId, member)) }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const revision = await guilds().memberDirectoryRevision(guildId);
    const page = await cachedGuildMemberPage(token, guildId, revision, after ?? undefined);
    return NextResponse.json({ members: page.filter((member) => !member.user.bot).map((member) => directoryMember(guildId, member)), nextAfter: page.length === 1000 ? page.at(-1)?.user.id : null, revision: after ? undefined : revision }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'Bot not installed') return NextResponse.json({ error: 'Bot not installed' }, { status: 409 });
    if (error instanceof DiscordApiError && error.status === 403 && query === undefined) return NextResponse.json({ error: 'Guild Members Intent required' }, { status: 409 });
    console.error('Member directory request failed', { guildId, error });
    return NextResponse.json({ error: 'Member directory unavailable' }, { status: 503 });
  }
}
