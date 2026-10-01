import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { guildIdSchema } from '@scrt/validation';
import { env } from './server';

const schema = z.object({ state: z.string().min(32), verifier: z.string().min(32), guildId: guildIdSchema, userId: guildIdSchema, expiresAt: z.number().int() });
export type InstallationState = z.infer<typeof schema>;
const signature = (payload: string) => createHmac('sha256', env().SESSION_SECRET).update(`scrt-install:${payload}`).digest();

export function signInstallationState(input: Omit<InstallationState, 'expiresAt'>): string {
  const payload = Buffer.from(JSON.stringify(schema.parse({ ...input, expiresAt: Date.now() + 600_000 }))).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function readInstallationState(value: string | undefined): InstallationState | null {
  if (!value || value.length > 4096) return null;
  try {
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const [payload, encodedSignature] = parts as [string, string];
    const supplied = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = schema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.success && parsed.data.expiresAt > Date.now() ? parsed.data : null;
  } catch { return null; }
}
