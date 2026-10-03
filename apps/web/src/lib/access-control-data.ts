import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { botGuildMember, DiscordApiError } from '@scrt/discord';
import { env } from './server';

// Presentation data only. Guards and mutations always use live permission facts.
export const accessMemberProfile = cache((guildId: string, userId: string, directoryRevision: number) => unstable_cache(
  async () => {
    try { return await botGuildMember(env().DISCORD_BOT_TOKEN, guildId, userId); }
    catch (error) { if (error instanceof DiscordApiError && error.status === 404) return null; throw error; }
  },
  ['access-member-profile', guildId, userId, String(directoryRevision)], { revalidate: 60 },
)());
