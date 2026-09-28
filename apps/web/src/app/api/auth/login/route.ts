import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { loginUrl } from '@scrt/discord';
import { callbackUrl, env } from '@/lib/server';
import { cookieOptions } from '@/lib/session';

export async function GET() {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const response = NextResponse.redirect(loginUrl(env().DISCORD_CLIENT_ID, callbackUrl(), state, challenge));
  response.cookies.set('scrt_oauth_state', state, { ...cookieOptions(), maxAge: 600 });
  response.cookies.set('scrt_oauth_verifier', verifier, { ...cookieOptions(), maxAge: 600 });
  return response;
}
