import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { DiscordApiError, discordUser, refreshTokens, type DiscordUser } from '@scrt/discord';
import { log } from '@scrt/shared';
import { env } from './server';

type Session = { accessToken: string; refreshToken: string; accessExpiresAt: number; sessionExpiresAt: number; user?: DiscordUser };
type Tokens = Awaited<ReturnType<typeof refreshTokens>>;
const pendingRefreshes = new Map<string, Promise<Tokens>>();
const key = () => createHash('sha256').update(env().SESSION_SECRET).digest();
const name = 'scrt_session';
export class SessionRefreshUnavailableError extends Error {
  constructor() { super('Session refresh temporarily unavailable'); }
}
export const cookieOptions = () => ({ httpOnly: true, secure: env().NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' });

function seal(session: Session): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function unseal(value: string): Session | null {
  try {
    const data = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
    if (!parsed || typeof parsed !== 'object' || !('sessionExpiresAt' in parsed) || typeof parsed.sessionExpiresAt !== 'number' || parsed.sessionExpiresAt < Date.now()) return null;
    return parsed as Session;
  } catch { return null; }
}
export async function createSession(tokens: { access_token: string; refresh_token: string; expires_in: number }, user: DiscordUser) {
  const session: Session = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accessExpiresAt: Date.now() + tokens.expires_in * 1000, sessionExpiresAt: Date.now() + 7 * 86400_000, user };
  (await cookies()).set(name, seal(session), { ...cookieOptions(), maxAge: 7 * 86400 });
}
export async function sessionUser(): Promise<DiscordUser | null> {
  const value = (await cookies()).get(name)?.value;
  const session = value ? unseal(value) : null;
  return session?.user ?? null;
}
export async function hasSession(): Promise<boolean> {
  const value = (await cookies()).get(name)?.value;
  return Boolean(value && unseal(value));
}
export async function accessToken(): Promise<string | null> {
  const value = (await cookies()).get(name)?.value;
  const session = value ? unseal(value) : null;
  if (!session) return null;
  if (session.accessExpiresAt > Date.now() + 10_000) return session.accessToken;
  // Refresh in a Route Handler so its Set-Cookie reaches the browser.
  return null;
}
export async function refreshSession(force = false): Promise<boolean> {
  const value = (await cookies()).get(name)?.value;
  const session = value ? unseal(value) : null;
  if (!session) return false;
  if (!force && session.accessExpiresAt > Date.now() + 10_000) return true;
  let tokens: Tokens;
  let user: DiscordUser;
  try {
    // Parallel navigation requests can carry the same old cookie. Reusing the
    // result prevents a rotated Discord refresh token from being spent twice.
    const refreshKey = createHash('sha256').update(session.refreshToken).digest('hex');
    let pending = pendingRefreshes.get(refreshKey);
    if (!pending) {
      pending = refreshTokens(env().DISCORD_CLIENT_ID, env().DISCORD_CLIENT_SECRET, session.refreshToken);
      pendingRefreshes.set(refreshKey, pending);
      const current = pending;
      void current.then(
        () => { setTimeout(() => { if (pendingRefreshes.get(refreshKey) === current) pendingRefreshes.delete(refreshKey); }, 30_000).unref(); },
        () => { if (pendingRefreshes.get(refreshKey) === current) pendingRefreshes.delete(refreshKey); },
      );
    }
    tokens = await pending;
    user = session.user ?? await discordUser(tokens.access_token);
  } catch (error) {
    if (error instanceof DiscordApiError && error.code === 'invalid_grant') { (await cookies()).delete(name); return false; }
    log('warn', 'auth', 'session.refresh.unavailable', error instanceof DiscordApiError ? { status: error.status, endpoint: error.endpoint, code: error.code } : {});
    // Network/cooldown/provider failures do not revoke the user's refresh token.
    throw new SessionRefreshUnavailableError();
  }
  await createSession(tokens, user);
  return true;
}
export async function clearSession() { (await cookies()).delete(name); }
