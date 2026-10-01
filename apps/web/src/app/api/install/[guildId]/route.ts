import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { canManageGuild, discordGuilds, installAuthorizationUrl } from '@scrt/discord';
import { guildIdSchema } from '@scrt/validation';
import { requireSession } from '@/lib/guards';
import { cookieOptions } from '@/lib/session';
import { appUrl, callbackUrl, env, guilds } from '@/lib/server';
import { signInstallationState } from '@/lib/installation-state';

export async function GET(_request: Request, context: { params: Promise<{ guildId: string }> }) {
  const parsed = guildIdSchema.safeParse((await context.params).guildId);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid guild ID' }, { status: 400 });
  const guildId = parsed.data;
  const { token, user } = await requireSession(`/api/install/${guildId}`);
  const guild = (await discordGuilds(token)).find((item) => item.id === guildId);
  if (!guild || !canManageGuild(guild)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if ((await guilds().get(guildId))?.botInstalled) return NextResponse.redirect(new URL(`/servers/${guildId}`, appUrl()));

  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const response = NextResponse.redirect(installAuthorizationUrl(env().DISCORD_CLIENT_ID, guildId, callbackUrl(), state, challenge));
  response.cookies.set('scrt_install', signInstallationState({ state, verifier, guildId, userId: user.id }), { ...cookieOptions(), maxAge: 600 });
  return response;
}
