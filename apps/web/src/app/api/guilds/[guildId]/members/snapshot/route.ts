import { NextResponse } from 'next/server';
import { directoryMember, DiscordApiError } from '@scrt/discord';
import { guildIdSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { cachedGuildMemberPage } from '@/lib/member-directory-cache';
import { accessRoleMember } from '@/lib/member-directory-scope';
import { accessToken } from '@/lib/session';
import { env, guilds } from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = guildIdSchema.safeParse((await context.params).guildId);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid guild ID' }, { status: 400 });
  const guildId = parsed.data;
  try {
    const access = await requireGuildAccess(guildId, 'settings.view');
    const full = access.permissions.has('settings.manage');
    const [revision, mappings] = await Promise.all([
      guilds().memberDirectoryRevision(guildId),
      full ? Promise.resolve(null) : guilds().accessMappings(guildId),
    ]);
    const mappedRoles = new Set(mappings?.roles.map((mapping) => mapping.discordRoleId) ?? []);
    const encoder = new TextEncoder();
    let closed = false;
    let stop = () => {};
    let after: string | undefined;
    let finished = !full && !mappedRoles.size;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        stop = () => {
          if (closed) return;
          closed = true;
          request.signal.removeEventListener('abort', stop);
          try { controller.close(); } catch { /* Client already closed the stream. */ }
        };
        request.signal.addEventListener('abort', stop, { once: true });
        if (request.signal.aborted) { stop(); return; }
      },
      async pull(controller) {
        if (closed) return;
        const send = (value: unknown) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); };
        try {
          if (finished) {
            send({ kind: 'done', revision: await guilds().memberDirectoryRevision(guildId) });
            stop();
            return;
          }
          const page = await cachedGuildMemberPage(env().DISCORD_BOT_TOKEN, guildId, revision, after);
          if (closed) return;
          const members = page.filter((member) => !member.user.bot).map((member) => directoryMember(guildId, member));
          send({ kind: 'page', revision, members: full ? members : members.map((member) => accessRoleMember(guildId, member, mappedRoles)).filter((member) => member !== null) });
          after = page.length === 1000 ? page.at(-1)?.user.id : undefined;
          finished = !after;
        } catch (error) {
          console.error('Member snapshot stream failed', { guildId, error });
          send({ kind: 'error', error: error instanceof DiscordApiError && error.status === 403 ? 'intent' : 'unavailable' });
          stop();
        }
      },
      cancel() { stop(); },
    }, { highWaterMark: 0 });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'Bot not installed') return NextResponse.json({ error: 'Bot not installed' }, { status: 409 });
    console.error('Member snapshot authorization failed', { guildId, error });
    return NextResponse.json({ error: 'Member directory unavailable' }, { status: 503 });
  }
}
