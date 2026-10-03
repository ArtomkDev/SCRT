import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { cert } from 'firebase-admin/app';
import { Client } from 'discord.js';
import { botEnv } from '@scrt/config';
import { ActivityLeaderboardService, ActivityRepository, VoiceRepository, firestore } from '@scrt/database';
import { activitySessionSchema, activitySettingsSchema } from '@scrt/validation';
import { activityDate, activityStreakEpoch } from '@scrt/shared';
import { activityGatewayIntents, presenceIntentAvailable } from './modules/activity/gateway';
import { ActivitySessionService } from './modules/activity/session-service';

config({ path: '../../.env', quiet: true });
const env = botEnv();
const credentials = { projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') };
const db = firestore(credentials);
const repository = new ActivityRepository(db);
// Synthetic snowflakes, never the configured live guild or a real member.
const guildId = `99999${Date.now()}`;
const userId = `88888${Date.now()}`;
const root = db.collection('guilds').doc(guildId);
const now = Date.now();
const settings = activitySettingsSchema.parse({ enabled: true });
const service = new ActivityLeaderboardService(repository, () => now);
let client: Client | undefined;

async function ensureIndexes() {
  const definition = JSON.parse(await readFile('../../firestore.indexes.json', 'utf8')) as { indexes: Array<{ collectionGroup: string; queryScope: string; fields: unknown[] }> };
  const token = (await cert(credentials).getAccessToken()).access_token;
  for (const index of definition.indexes) {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/collectionGroups/${index.collectionGroup}/indexes`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ queryScope: index.queryScope, fields: index.fields }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok && response.status !== 409) throw new Error(`Index creation failed (${response.status}) for ${index.collectionGroup}`);
    console.info(`Index ${index.collectionGroup}: ${response.status === 409 ? 'already exists' : 'creation requested'}`);
  }
}

try {
  if (process.argv.includes('--apply-indexes')) await ensureIndexes();
  assert.equal((await root.get()).exists, false, 'Verification namespace must not exist');
  await root.create({ purpose: 'SCRT isolated activity verification', createdAt: new Date() });
  const voice = new VoiceRepository(db);
  await voice.audit({ guildId, action: 'room.created', source: 'discord', actorId: userId, targetUserId: undefined });
  await voice.audit({ guildId, action: 'room.deleted', source: 'discord', actorId: undefined });
  await voice.audit({ guildId, action: 'voice.recovery', source: 'recovery' });
  const audits = await root.collection('voiceAudit').get();
  assert.equal(audits.size, 3);
  for (const audit of audits.docs) {
    assert.equal(audit.get('targetUserId'), null);
    assert.equal(audit.get('channelId'), null);
    assert.equal(audit.get('creatorId'), null);
    assert.equal(audit.get('actorId'), audit.get('action') === 'room.created' ? userId : null);
  }
  console.info('Voice audit omitted/undefined optional fields: PASS');
  await repository.saveSettings(guildId, settings, userId);
  const date = activityDate(now, settings.streak.timezone);
  await repository.flushMessages(guildId, 'live-batch', [{ userId, date, count: 3, observedAt: now }]);
  await repository.flushMessages(guildId, 'live-batch', [{ userId, date, count: 3, observedAt: now }]);
  assert.equal((await repository.collection(guildId, 'activityMembers').doc(userId).get()).get('messages'), 3);
  console.info('Message batch / duplicate retry: PASS');
  for (const tracker of ['voice', 'stream', 'game'] as const) {
    const session = activitySessionSchema.parse({ id: randomUUID(), guildId, userId, tracker, channelId: tracker === 'game' ? null : `77777${now}`, startedAt: now - 600000, cursorAt: now - 600000, lastObservedAt: now - 600000, qualified: false, timezone: settings.streak.timezone, minimumSeconds: 60, streakMinimum: 300, streakEpoch: activityStreakEpoch(settings), game: tracker === 'game' ? { gameKey: `name:verification ${randomInt(1, 100000)}`, displayName: 'Verification Game', applicationId: null } : null, schemaVersion: 1 });
    await repository.startSession(session);
    assert.equal((await repository.listSessions(guildId)).length, 1);
    await repository.settleSession(guildId, session.id, now, true);
    await repository.settleSession(guildId, session.id, now, true);
    assert.equal((await repository.listSessions(guildId)).length, 0);
    console.info(`${tracker} start / aggregate / duplicate close / cleanup: PASS`);
  }
  const member = await repository.collection(guildId, 'activityMembers').doc(userId).get();
  assert.equal(member.get('voiceSeconds'), 600); assert.equal(member.get('streamSeconds'), 600); assert.equal(member.get('currentVoiceStreak'), 1);
  console.info('Voice / stream independence and streak: PASS');
  const first = new ActivitySessionService(repository);
  const desired = [{ tracker: 'voice' as const, channelId: `77777${now}`, game: null }];
  await first.reconcile(guildId, userId, desired, settings, now - 300000);
  await first.checkpoint(guildId, now - 120000);
  const restarted = new ActivitySessionService(repository);
  await restarted.recover(guildId);
  assert.equal((await repository.listSessions(guildId)).length, 0);
  assert.equal((await repository.collection(guildId, 'activityMembers').doc(userId).get()).get('voiceSeconds'), 780);
  console.info('Restart recovery at durable boundary, no invented downtime: PASS');
  const midnightStart = Date.parse('2026-09-28T20:30:00Z');
  const midnight = activitySessionSchema.parse({ id: randomUUID(), guildId, userId, tracker: 'stream', channelId: `77777${now}`, startedAt: midnightStart, cursorAt: midnightStart, lastObservedAt: midnightStart, qualified: false, timezone: settings.streak.timezone, minimumSeconds: 60, streakMinimum: 300, streakEpoch: activityStreakEpoch(settings), game: null, schemaVersion: 1 });
  await repository.startSession(midnight);
  await repository.settleSession(guildId, midnight.id, midnightStart + 7200000, true);
  assert.equal((await repository.collection(guildId, 'activityDailyMembers').doc(`2026-09-28_${userId}`).get()).get('streamSeconds'), 1800);
  assert.equal((await repository.collection(guildId, 'activityDailyMembers').doc(`2026-09-29_${userId}`).get()).get('streamSeconds'), 5400);
  console.info('Live guild-timezone midnight split: PASS');
  await repository.saveProfile(guildId, { userId, displayName: 'Verification Member', username: 'verification', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png', searchName: 'verification member', updatedAt: now });
  assert.equal((await service.directory(guildId, 'verif')).profiles[0]?.userId, userId);
  console.info('Live directory prefix query: PASS');
  for (const period of ['today', '7d', '30d', 'all'] as const) {
    try {
      assert.equal((await service.memberLeaderboard(guildId, 'messages', period))[0]?.value, 3);
      const game = (await service.games(guildId, period))[0]!;
      assert.equal(game.totalSeconds, 600);
      assert.equal((await service.gamePlayers(guildId, game.gameKey, period))[0]?.totalSeconds, 600);
      assert.equal((await service.memberGames(guildId, userId, period))[0]?.totalSeconds, 600);
      assert.equal((await service.member(guildId, userId, period)).messages, 3);
      console.info(`Live leaderboard query ${period}: PASS`);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 9) { console.info(`Live leaderboard query ${period}: BLOCKED - deploy firestore.indexes.json`); process.exitCode = 1; }
      else throw error;
    }
  }
  assert.equal((await service.memberLeaderboard(guildId, 'currentVoiceStreak', 'all'))[0]?.value, 1);
  assert.equal((await service.memberLeaderboard(guildId, 'longestVoiceStreak', 'all'))[0]?.value, 1);
  console.info('Live current/longest streak queries: PASS');
  const presence = await presenceIntentAvailable(env.DISCORD_BOT_TOKEN);
  console.info(`Presence Intent Portal availability: ${presence ? 'available' : 'UNAVAILABLE — enable manually'}`);
  client = new Client({ intents: activityGatewayIntents(presence, env.DISCORD_GUILD_MEMBERS_INTENT) });
  await client.login(env.DISCORD_BOT_TOKEN);
  console.info(`Discord Gateway startup: PASS (${client.guilds.cache.size} guilds)`);
  console.info('Live messages / voice join / screen share / game launch: BLOCKED - manual action required');
} finally {
  await client?.destroy();
  const marker = await root.get();
  if (marker.get('purpose') === 'SCRT isolated activity verification') { await db.recursiveDelete(root); console.info('Isolated verification documents cleaned: PASS'); }
  await db.terminate();
}
