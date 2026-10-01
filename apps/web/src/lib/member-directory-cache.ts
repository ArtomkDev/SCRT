import 'server-only';
import { createHash } from 'node:crypto';
import { botListGuildMembers, type BotGuildMember } from '@scrt/discord';

const ttlMs = 120_000;
const maxPages = 80;
const maxPendingPages = 32;
const pages = new Map<string, { expiresAt: number; members: BotGuildMember[] }>();
const pending = new Map<string, Promise<BotGuildMember[]>>();

export async function cachedGuildMemberPage(token: string, guildId: string, revision: number, after?: string): Promise<BotGuildMember[]> {
  const credentials = createHash('sha256').update(token).digest('hex');
  const key = `${credentials}:${guildId}:${revision}:${after ?? ''}`;
  const hit = pages.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    pages.delete(key);
    pages.set(key, hit);
    return hit.members;
  }
  pages.delete(key);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= maxPendingPages) throw new Error('Member directory is busy');
  const request = botListGuildMembers(token, guildId, after);
  pending.set(key, request);
  try {
    const members = await request;
    pages.set(key, { expiresAt: Date.now() + ttlMs, members });
    while (pages.size > maxPages) pages.delete(pages.keys().next().value!);
    return members;
  } finally {
    pending.delete(key);
  }
}
