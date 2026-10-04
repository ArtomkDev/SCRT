import { NextResponse } from 'next/server';
import { botGuildMember, botSearchGuildMembers, directoryMember, DiscordApiError } from '@scrt/discord';
import { guildIdSchema, snowflakeSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { accessToken } from '@/lib/session';
import { env } from '@/lib/server';
import { log } from '@scrt/shared';

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return NextResponse.json({ error: 'Потрібен вхід.' }, { status: 401 });
  const parsed = guildIdSchema.safeParse((await context.params).guildId);
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!parsed.success || query.length < 2 || query.length > 50) return NextResponse.json({ error: 'Некоректний пошук.' }, { status: 400 });
  try {
    await requireGuildAccess(parsed.data, 'activity.manage');
    const token = env().DISCORD_BOT_TOKEN;
    let members: Awaited<ReturnType<typeof botSearchGuildMembers>>;
    if (snowflakeSchema.safeParse(query).success) {
      try { members = [await botGuildMember(token, parsed.data, query)]; }
      catch (error) {
        if (!(error instanceof DiscordApiError) || error.status !== 404) throw error;
        members = [];
      }
    } else members = await botSearchGuildMembers(token, parsed.data, query);
    return NextResponse.json({ members: members.filter((member) => !member.user.bot).map((member) => directoryMember(parsed.data, member)) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Недостатньо прав.' }, { status: 403 });
    log('warn', 'activity', 'member-search.failed', { guildId: parsed.data }, error);
    return NextResponse.json({ error: 'Пошук Discord тимчасово недоступний.' }, { status: 503 });
  }
}
