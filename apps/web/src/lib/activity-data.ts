import 'server-only';
import { cache } from 'react';
import { botGuildMember, directoryMember, DiscordApiError } from '@scrt/discord';
import { type ActivityMetric, type ActivityPeriod } from '@scrt/shared';
import { activityPeriodSchema } from '@scrt/validation';
import { activity, activityLeaderboards, env } from './server';
import { requireGuildAccess } from './guards';
import { activityProfileReader } from './activity-profiles';

const requestProfiles = cache(() => activityProfileReader((guildId, ids) => activity().profiles(guildId, ids)));

export const activitySettings = cache(async (guildId: string) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().getSettings(guildId); });
export const activityHealth = cache(async (guildId: string) => { await requireGuildAccess(guildId, 'activity.view'); return activity().health(guildId); });
export const activityOverview = cache(async (guildId: string, period: ActivityPeriod) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().overview(guildId, period); });
export const activityRanking = cache(async (guildId: string, metric: ActivityMetric, period: ActivityPeriod, limit = 25) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().memberLeaderboard(guildId, metric, period, limit); });
export const activityGames = cache(async (guildId: string, period: ActivityPeriod, limit = 25) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().games(guildId, period, limit); });
export const activityProfiles = cache(async (guildId: string, ids: string) => { await requireGuildAccess(guildId, 'activity.view'); return requestProfiles()(guildId, ids ? ids.split(',') : []); });
export const activityDirectory = cache(async (guildId: string, search: string, after?: string) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().directory(guildId, search, after); });
export const activityMember = cache(async (guildId: string, userId: string, period: ActivityPeriod) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().member(guildId, userId, period); });
export const activityMemberGames = cache(async (guildId: string, userId: string, period: ActivityPeriod) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().memberGames(guildId, userId, period); });
export const activityGame = cache(async (guildId: string, gameKey: string, period: ActivityPeriod = 'all') => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().game(guildId, gameKey, period); });
export const activityGamePlayers = cache(async (guildId: string, gameKey: string, period: ActivityPeriod) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().gamePlayers(guildId, gameKey, period); });
export async function activityMemberIdentity(guildId: string, userId: string) {
  await requireGuildAccess(guildId, 'activity.view');
  try { return { member: directoryMember(guildId, await botGuildMember(env().DISCORD_BOT_TOKEN, guildId, userId)), left: false }; }
  catch (error) { if (error instanceof DiscordApiError && error.status === 404) return { member: null, left: true }; throw error; }
}
export function activityPeriod(value: string | string[] | undefined): ActivityPeriod {
  const parsed = activityPeriodSchema.safeParse(value ?? 'all');
  return parsed.success ? parsed.data : 'all';
}

export const activityMessageSummary = cache(async (guildId: string, period: ActivityPeriod) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().messageSummary(guildId, period); });
export const activityVoiceSummary = cache(async (guildId: string, period: ActivityPeriod) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().voiceSummary(guildId, period); });
export const activityObservedGames = cache(async (guildId: string, after?: string) => { await requireGuildAccess(guildId, 'activity.view'); return activityLeaderboards().observedGames(guildId, after); });
