import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { discordUser, exchangeCode } from '@scrt/discord';
import { appUrl, callbackUrl, env } from '@/lib/server';
import { createSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const state = request.nextUrl.searchParams.get('state');
  const expected = jar.get('scrt_oauth_state')?.value;
  const verifier = jar.get('scrt_oauth_verifier')?.value;
  jar.delete('scrt_oauth_state'); jar.delete('scrt_oauth_verifier');
  if (!state || !expected || !verifier || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return NextResponse.redirect(new URL('/?error=oauth_state', appUrl()));
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/?error=oauth_denied', appUrl()));
  try {
    const tokens = await exchangeCode(env().DISCORD_CLIENT_ID, env().DISCORD_CLIENT_SECRET, callbackUrl(), code, verifier);
    await createSession(tokens, await discordUser(tokens.access_token));
    return NextResponse.redirect(new URL('/servers', appUrl()));
  } catch { return NextResponse.redirect(new URL('/?error=oauth_failed', appUrl())); }
}
