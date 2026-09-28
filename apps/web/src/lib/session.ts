import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { refreshTokens } from '@scrt/discord';
import { env } from './server';

type Session = { accessToken: string; refreshToken: string; accessExpiresAt: number; sessionExpiresAt: number };
const key = () => createHash('sha256').update(env().SESSION_SECRET).digest();
const name = 'scrt_session';
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
export async function createSession(tokens: { access_token: string; refresh_token: string; expires_in: number }) {
  const session: Session = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accessExpiresAt: Date.now() + tokens.expires_in * 1000, sessionExpiresAt: Date.now() + 7 * 86400_000 };
  (await cookies()).set(name, seal(session), { ...cookieOptions(), maxAge: 7 * 86400 });
}
export async function accessToken(): Promise<string | null> {
  const value = (await cookies()).get(name)?.value;
  const session = value ? unseal(value) : null;
  if (!session) return null;
  if (session.accessExpiresAt > Date.now() + 60_000) return session.accessToken;
  // Refresh in a Route Handler so its Set-Cookie reaches the browser.
  return null;
}
export async function refreshSession(): Promise<boolean> {
  const value = (await cookies()).get(name)?.value;
  const session = value ? unseal(value) : null;
  if (!session) return false;
  if (session.accessExpiresAt > Date.now() + 60_000) return true;
  try {
    const tokens = await refreshTokens(env().DISCORD_CLIENT_ID, env().DISCORD_CLIENT_SECRET, session.refreshToken);
    await createSession(tokens);
    return true;
  } catch { (await cookies()).delete(name); return false; }
}
export async function clearSession() { (await cookies()).delete(name); }
