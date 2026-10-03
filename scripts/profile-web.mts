import { performance } from 'node:perf_hooks';
import { webEnv } from '../packages/config/src/index';
import { firestore, GuildRepository, VoiceRepository, ActivityRepository, ActivityLeaderboardService } from '../packages/database/src/index';
import { botGuild, botGuildMember, DiscordApiError } from '../packages/discord/src/index';

// Read-only upstream measurements. No OAuth impersonation, browser cookies or writes.
try { process.loadEnvFile('.env'); } catch { /* Deployment environments already provide variables. */ }
const config = webEnv();
const db = firestore({ projectId: config.FIREBASE_PROJECT_ID, clientEmail: config.FIREBASE_CLIENT_EMAIL, privateKey: config.FIREBASE_PRIVATE_KEY });
const guilds = new GuildRepository(db);
const voice = new VoiceRepository(db);
const activity = new ActivityRepository(db);
const measurements: Array<{ operation: string; ms: number }> = [];

async function measure<T>(operation: string, read: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await read(); }
  finally { measurements.push({ operation, ms: Math.round(performance.now() - start) }); }
}

try {
  const installed = await measure('firestore.cold-installed-guild', () => db.collection('guilds').where('botInstalled', '==', true).limit(20).get());
  let selected: { guildId: string; guild: Awaited<ReturnType<typeof botGuild>> } | undefined;
  for (const candidate of installed.docs.filter((doc) => /^\d{17,20}$/.test(doc.id))) {
    try {
      selected = { guildId: candidate.id, guild: await measure('discord.live-guild', () => botGuild(config.DISCORD_BOT_TOKEN, candidate.id)) };
      break;
    } catch (error) { if (!(error instanceof DiscordApiError) || error.status !== 404) throw error; }
  }
  if (!selected) throw new Error('No currently installed guild to measure');
  const { guildId, guild: liveGuild } = selected;
  await measure('discord.live-owner-membership', () => botGuildMember(config.DISCORD_BOT_TOKEN, guildId, liveGuild.owner_id));
  await measure('firestore.live-access-records', () => Promise.all([guilds.get(guildId), guilds.accessMappings(guildId)]));
  await measure('voice.cold-records', () => Promise.all([voice.getSettings(guildId), voice.listCreators(guildId), voice.listRooms(guildId)]));
  const leaders = new ActivityLeaderboardService(activity);
  await measure('activity.cold-overview', () => Promise.all([
    leaders.overview(guildId, 'today'), leaders.games(guildId, 'today'),
    leaders.memberLeaderboard(guildId, 'messages', 'today'), leaders.memberLeaderboard(guildId, 'voiceSeconds', 'today'),
    leaders.memberLeaderboard(guildId, 'currentVoiceStreak', 'all'),
  ]));
  await measure('activity.messages-four-periods', () => leaders.messageTotals(guildId));
  await measure('guard.targeted-parallel-live-reads', () => Promise.all([
    botGuild(config.DISCORD_BOT_TOKEN, guildId), botGuildMember(config.DISCORD_BOT_TOKEN, guildId, liveGuild.owner_id),
    guilds.get(guildId), guilds.accessMappings(guildId),
  ]));
  console.log(JSON.stringify({ kind: 'read-only-live-upstream-profile', measurements, limitations: 'Upstream timing only; not authenticated browser or production HTTP timing.' }, null, 2));
} finally { await db.terminate(); }
