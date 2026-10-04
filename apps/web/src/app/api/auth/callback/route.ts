import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { administratorRoleIds, botGuild, botGuildMember, botGuildRoles, canMemberManageGuild, discordUser, exchangeCode } from '@scrt/discord';
import { guildIdSchema } from '@scrt/validation';
import { appUrl, callbackUrl, env, guilds } from '@/lib/server';
import { createSession, sessionUser } from '@/lib/session';
import { readInstallationState, type InstallationState } from '@/lib/installation-state';

async function finishInstallation(request: NextRequest, install: InstallationState) {
  const guildId = guildIdSchema.safeParse(request.nextUrl.searchParams.get('guild_id'));
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/servers?install=denied', appUrl()));
  if (!guildId.success || guildId.data !== install.guildId) return NextResponse.redirect(new URL('/servers?install=failed', appUrl()));
  try {
    const tokens = await exchangeCode(env().DISCORD_CLIENT_ID, env().DISCORD_CLIENT_SECRET, callbackUrl(), code, install.verifier);
    const [authorizedUser, currentUser] = await Promise.all([discordUser(tokens.access_token), sessionUser()]);
    if (authorizedUser.id !== install.userId || currentUser?.id !== install.userId) throw new Error('Installer identity mismatch');
    const token = env().DISCORD_BOT_TOKEN;
    const [guild, member, roles] = await Promise.all([
      botGuild(token, guildId.data), botGuildMember(token, guildId.data, install.userId), botGuildRoles(token, guildId.data),
    ]);
    if (guild.id !== guildId.data || member.user.id !== install.userId || member.user.bot) throw new Error('Installer guild mismatch');
    if (!canMemberManageGuild(guild, member, roles)) throw new Error('Installer can no longer manage this guild');
    const admins = administratorRoleIds(roles);
    await guilds().upsertInstalled({ guildId: guild.id, name: guild.name, icon: guild.icon, ownerId: guild.owner_id }, admins);
    await guilds().grantInstallerAccess(guildId.data, install.userId, admins, guild.owner_id);
    return NextResponse.redirect(new URL(`/servers/${guildId.data}/settings/access-control`, appUrl()));
  } catch (error) {
    console.error('Bot installation access setup failed', { guildId: install.guildId, error });
    return NextResponse.redirect(new URL('/servers?install=failed', appUrl()));
  }
}

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const state = request.nextUrl.searchParams.get('state');
  const rawInstall = jar.get('scrt_install')?.value;
  const install = readInstallationState(rawInstall);
  if (state && install && Buffer.byteLength(state) === Buffer.byteLength(install.state) && timingSafeEqual(Buffer.from(state), Buffer.from(install.state))) {
    jar.delete('scrt_install');
    return finishInstallation(request, install);
  }
  const expected = jar.get('scrt_oauth_state')?.value;
  const verifier = jar.get('scrt_oauth_verifier')?.value;
  jar.delete('scrt_oauth_state'); jar.delete('scrt_oauth_verifier');
  if (!state || !expected || !verifier || Buffer.byteLength(state) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return NextResponse.redirect(new URL('/?error=oauth_state', appUrl()));
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/?error=oauth_denied', appUrl()));
  try {
    const tokens = await exchangeCode(env().DISCORD_CLIENT_ID, env().DISCORD_CLIENT_SECRET, callbackUrl(), code, verifier);
    await createSession(tokens, await discordUser(tokens.access_token));
    return NextResponse.redirect(new URL('/servers', appUrl()));
  } catch { return NextResponse.redirect(new URL('/?error=oauth_failed', appUrl())); }
}
