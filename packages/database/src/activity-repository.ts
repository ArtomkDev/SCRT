import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { activityGameKeySchema, activitySessionSchema, activitySettingsSchema, guildIdSchema, snowflakeSchema, type ActivitySession, type ActivitySettings } from '@scrt/validation';
import { qualifyVoiceDate, splitActivityDuration, type ActivityProfile } from '@scrt/shared';

export type MessageIncrement = { userId: string; date: string; count: number; observedAt: number };
export type ActivityHealth = { observedAt: number; connected: boolean; presence: boolean; aggregation: boolean; recovery: boolean; activeVoice: number; activeStream: number; activeGames: number };
export const activityKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const counter = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export class ActivityRepository {
  constructor(readonly db: Firestore) {}
  root(guildId: string) { return this.db.collection('guilds').doc(guildIdSchema.parse(guildId)); }
  collection(guildId: string, name: string) { return this.root(guildId).collection(name); }
  async getSettings(guildId: string): Promise<ActivitySettings> {
    return activitySettingsSchema.parse((await this.collection(guildId, 'activitySettings').doc('main').get()).data() ?? {});
  }
  watchSettings(guildId: string, next: (settings: ActivitySettings) => void, fail: (error: Error) => void): () => void {
    return this.collection(guildId, 'activitySettings').doc('main').onSnapshot((snapshot) => {
      const result = activitySettingsSchema.safeParse(snapshot.data() ?? {});
      if (result.success) next(result.data); else fail(new Error('Invalid Activity configuration'));
    }, fail);
  }
  async saveSettings(guildId: string, input: ActivitySettings, actorId: string): Promise<void> {
    const value = activitySettingsSchema.parse(input);
    const ref = this.collection(guildId, 'activitySettings').doc('main');
    await this.db.runTransaction(async (tx) => {
      const prior = await tx.get(ref);
      const previous = activitySettingsSchema.parse(prior.data() ?? {});
      const changedStreak = previous.streak.timezone !== value.streak.timezone || previous.streak.minimumVoiceSecondsPerDay !== value.streak.minimumVoiceSecondsPerDay || previous.tracking.voiceStreaks !== value.tracking.voiceStreaks;
      tx.set(ref, { ...value, games: { ...value.games, ignoredGameKeys: previous.games.ignoredGameKeys }, streakRevision: previous.streakRevision + (changedStreak ? 1 : 0), updatedAt: FieldValue.serverTimestamp(), createdAt: prior.get('createdAt') ?? FieldValue.serverTimestamp() });
      tx.create(this.collection(guildId, 'activityAudit').doc(), { actorId: snowflakeSchema.parse(actorId), action: prior.get('enabled') !== value.enabled ? value.enabled ? 'activity.enabled' : 'activity.disabled' : 'activity.settings_updated', timestamp: FieldValue.serverTimestamp() });
    });
  }
  async setGameIgnored(guildId: string, gameKey: string, ignored: boolean, actorId: string): Promise<void> {
    activityGameKeySchema.parse(gameKey);
    snowflakeSchema.parse(actorId);
    const ref = this.collection(guildId, 'activitySettings').doc('main');
    const gameRef = this.collection(guildId, 'activityGames').doc(activityKey(gameKey));
    await this.db.runTransaction(async (tx) => {
      const [settingsDoc, gameDoc] = await tx.getAll(ref, gameRef);
      if (!gameDoc!.exists || gameDoc!.get('gameKey') !== gameKey) throw new Error('Активність має належати цьому серверу.');
      const settings = activitySettingsSchema.parse(settingsDoc!.data() ?? {});
      const keys = new Set(settings.games.ignoredGameKeys);
      if (ignored) keys.add(gameKey); else keys.delete(gameKey);
      const next = activitySettingsSchema.parse({ ...settings, games: { ...settings.games, ignoredGameKeys: [...keys] } });
      tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp(), createdAt: settingsDoc!.get('createdAt') ?? FieldValue.serverTimestamp() });
      tx.create(this.collection(guildId, 'activityAudit').doc(), { actorId, action: ignored ? 'activity.game_ignored' : 'activity.game_tracked', gameKey, timestamp: FieldValue.serverTimestamp() });
    });
  }
  async flushMessages(guildId: string, token: string, increments: readonly MessageIncrement[]): Promise<void> {
    if (increments.length > 80) throw new Error('Activity message batch exceeds limit');
    const receipt = this.collection(guildId, 'activityBatches').doc(activityKey(token));
    await this.db.runTransaction(async (tx) => {
      if ((await tx.get(receipt)).exists) return;
      const ids = [...new Set(increments.map((item) => snowflakeSchema.parse(item.userId)))];
      const members = ids.length ? await tx.getAll(...ids.map((id) => this.collection(guildId, 'activityMembers').doc(id))) : [];
      const recent = new Map(ids.map((id, index) => [id, Math.max(counter(members[index]?.get('lastActivityAt')), ...increments.filter((item) => item.userId === id).map((item) => item.observedAt))]));
      for (const item of increments) {
        snowflakeSchema.parse(item.userId);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isSafeInteger(item.count) || item.count <= 0) throw new Error('Invalid message increment');
        const common = { userId: item.userId, messages: FieldValue.increment(item.count), lastActivityAt: recent.get(item.userId)!, updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 };
        tx.set(this.collection(guildId, 'activityMembers').doc(item.userId), common, { merge: true });
        tx.set(this.collection(guildId, 'activityDailyMembers').doc(`${item.date}_${item.userId}`), { ...common, date: item.date }, { merge: true });
      }
      tx.create(receipt, { expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400_000), committedAt: FieldValue.serverTimestamp() });
    });
  }
  async saveProfile(guildId: string, profile: ActivityProfile): Promise<void> {
    snowflakeSchema.parse(profile.userId);
    const searchPrefixes = [...new Set([profile.displayName, profile.username].flatMap((name) => {
      const normalized = name.normalize('NFKC').trim().toLocaleLowerCase('uk-UA').slice(0, 64);
      return Array.from({ length: normalized.length }, (_, index) => normalized.slice(0, index + 1));
    }))];
    await this.collection(guildId, 'activityProfiles').doc(profile.userId).set({ ...profile, searchPrefixes });
  }
  async profiles(guildId: string, userIds: readonly string[]): Promise<ActivityProfile[]> {
    if (!userIds.length) return [];
    const docs = await this.db.getAll(...userIds.slice(0, 100).map((id) => this.collection(guildId, 'activityProfiles').doc(snowflakeSchema.parse(id))));
    return docs.flatMap((doc) => doc.exists ? [doc.data() as ActivityProfile] : []);
  }
  async listSessions(guildId: string): Promise<ActivitySession[]> {
    const docs = await this.collection(guildId, 'activitySessions').get();
    return docs.docs.map((doc) => {
      const session = activitySessionSchema.parse(doc.data());
      if (session.guildId !== guildId || session.id !== doc.id) throw new Error('Cross-guild activity session');
      return session;
    });
  }
  async startSession(input: ActivitySession): Promise<void> {
    const value = activitySessionSchema.parse(input);
    // Stable id per attempt makes an uncertain network result safe to retry.
    const ref = this.collection(value.guildId, 'activitySessions').doc(value.id);
    await this.db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return;
      let base = 0;
      if (value.tracker === 'voice' && value.voiceRunEpoch) {
        const member = await tx.get(this.collection(value.guildId, 'activityMembers').doc(value.userId));
        if (member.get('voiceRunEpoch') === value.voiceRunEpoch && counter(member.get('voiceRunReturnUntil')) >= value.startedAt && counter(member.get('voiceRunEndedAt')) <= value.startedAt) base = counter(member.get('voiceRunMilliseconds'));
      }
      tx.create(ref, { ...value, voiceRunBaseMilliseconds: base });
    });
  }
  /** Cursor advance / deletion and every affected aggregate commit atomically. */
  async settleSession(guildId: string, id: string, end: number, close: boolean, voiceReturnSeconds = 0): Promise<ActivitySession | null> {
    if (!Number.isInteger(voiceReturnSeconds) || voiceReturnSeconds < 0 || voiceReturnSeconds > 86400) throw new Error('Invalid voice return grace');
    const ref = this.collection(guildId, 'activitySessions').doc(id);
    return this.db.runTransaction(async (tx) => {
      const persisted = await tx.get(ref);
      if (!persisted.exists) return null;
      const session = activitySessionSchema.parse(persisted.data());
      if (session.guildId !== guildId) throw new Error('Cross-guild activity session');
      const boundary = Math.max(session.cursorAt, Math.floor(end));
      const qualifies = session.qualified || (boundary - session.startedAt) / 1000 >= session.minimumSeconds;
      const slices = qualifies ? splitActivityDuration(session.cursorAt, boundary, session.timezone) : [];
      const memberRef = this.collection(guildId, 'activityMembers').doc(session.userId);
      const dailyRefs = slices.map((slice) => this.collection(guildId, 'activityDailyMembers').doc(`${slice.date}_${session.userId}`));
      const member = await tx.get(memberRef);
      const runMilliseconds = session.voiceRunBaseMilliseconds + boundary - session.startedAt;
      const runSeconds = Math.floor(runMilliseconds / 1000);
      const voiceRun = session.tracker === 'voice' && (runSeconds >= session.minimumSeconds || close && voiceReturnSeconds > 0) ? {
        longestVoiceRunSeconds: Math.max(counter(member.get('longestVoiceRunSeconds')), runSeconds >= session.minimumSeconds ? runSeconds : 0),
        voiceRunEpoch: session.voiceRunEpoch, voiceRunMilliseconds: runMilliseconds,
        voiceRunEndedAt: close ? boundary : 0, voiceRunReturnUntil: close && voiceReturnSeconds > 0 ? boundary + voiceReturnSeconds * 1000 : 0,
      } : null;
      const daily = dailyRefs.length ? await tx.getAll(...dailyRefs) : [];
      const gameId = session.game ? activityKey(session.game.gameKey) : null;
      const gameRef = gameId ? this.collection(guildId, 'activityGames').doc(gameId) : null;
      const playerRef = gameId ? this.collection(guildId, 'activityGameMembers').doc(`${gameId}_${session.userId}`) : null;
      const game = gameRef ? await tx.get(gameRef) : null;
      const player = playerRef ? await tx.get(playerRef) : null;
      const dailyGameRefs = gameId ? slices.map((slice) => this.collection(guildId, 'activityDailyGames').doc(`${slice.date}_${gameId}`)) : [];
      const dailyPlayerRefs = gameId ? slices.map((slice) => this.collection(guildId, 'activityDailyGameMembers').doc(`${slice.date}_${gameId}_${session.userId}`)) : [];
      const dailyGames = dailyGameRefs.length ? await tx.getAll(...dailyGameRefs) : [];
      const dailyPlayers = dailyPlayerRefs.length ? await tx.getAll(...dailyPlayerRefs) : [];
      const duration = slices.reduce((total, slice) => total + slice.seconds, 0);
      const epochMatches = member.get('streakEpoch') === session.streakEpoch;
      const lastQualified = member.get('lastQualifiedVoiceDate');
      let streak = { currentVoiceStreak: epochMatches ? counter(member.get('currentVoiceStreak')) : 0, longestVoiceStreak: counter(member.get('longestVoiceStreak')), lastQualifiedVoiceDate: epochMatches && typeof lastQualified === 'string' ? lastQualified : null };
      let sliceEnd = session.cursorAt;
      for (let index = 0; index < slices.length; index++) {
        const slice = slices[index]!;
        sliceEnd += slice.seconds * 1000;
        const metric = session.tracker === 'voice' ? 'voiceSeconds' : session.tracker === 'stream' ? 'streamSeconds' : null;
        if (metric) {
          const patch: Record<string, unknown> = { userId: session.userId, date: slice.date, [metric]: FieldValue.increment(slice.seconds), updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 };
          if (session.tracker === 'voice' && session.streakMinimum !== null && counter(daily[index]?.get('voiceSeconds')) + slice.seconds >= session.streakMinimum && daily[index]?.get('qualifiedEpoch') !== session.streakEpoch) {
            patch.qualifiedEpoch = session.streakEpoch;
            streak = qualifyVoiceDate(streak.currentVoiceStreak, streak.longestVoiceStreak, streak.lastQualifiedVoiceDate, slice.date);
          }
          tx.set(dailyRefs[index]!, patch, { merge: true });
        }
        if (session.game) {
          const common = { ...session.game, date: slice.date, totalSeconds: FieldValue.increment(slice.seconds), sessionCount: FieldValue.increment(!session.qualified && index === 0 ? 1 : 0), updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 };
          tx.set(dailyGameRefs[index]!, { ...common, lastPlayedAt: Math.max(counter(dailyGames[index]?.get('lastPlayedAt')), sliceEnd), uniquePlayers: FieldValue.increment(dailyPlayers[index]?.exists ? 0 : 1) }, { merge: true });
          tx.set(dailyPlayerRefs[index]!, { ...common, lastPlayedAt: Math.max(counter(dailyPlayers[index]?.get('lastPlayedAt')), sliceEnd), userId: session.userId }, { merge: true });
        }
      }
      if (duration > 0) {
        const metric = session.tracker === 'voice' ? 'voiceSeconds' : session.tracker === 'stream' ? 'streamSeconds' : null;
        tx.set(memberRef, { userId: session.userId, ...(metric ? { [metric]: FieldValue.increment(duration) } : {}), ...(session.tracker === 'voice' ? { ...streak, streakEpoch: session.streakEpoch, ...voiceRun } : {}), lastActivityAt: Math.max(counter(member.get('lastActivityAt')), boundary), updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 }, { merge: true });
        if (session.game && gameRef && playerRef) {
          // First observed spelling is canonical; presentation never oscillates with capitalization.
          const common = { ...session.game, totalSeconds: FieldValue.increment(duration), sessionCount: FieldValue.increment(session.qualified ? 0 : 1), updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 };
          tx.set(gameRef, { ...common, lastPlayedAt: Math.max(counter(game?.get('lastPlayedAt')), boundary), displayName: game?.get('displayName') ?? session.game.displayName, uniquePlayers: FieldValue.increment(player?.exists ? 0 : 1) }, { merge: true });
          tx.set(playerRef, { ...common, lastPlayedAt: Math.max(counter(player?.get('lastPlayedAt')), boundary), userId: session.userId }, { merge: true });
        }
      } else if (voiceRun) {
        tx.set(memberRef, { userId: session.userId, ...voiceRun, updatedAt: FieldValue.serverTimestamp(), schemaVersion: 1 }, { merge: true });
      }
      if (close) { tx.delete(ref); return null; }
      const next = { ...session, cursorAt: qualifies ? boundary : session.cursorAt, qualified: qualifies, lastObservedAt: boundary };
      tx.set(ref, next);
      return next;
    });
  }
  async saveHealth(guildId: string, health: ActivityHealth): Promise<void> { await this.collection(guildId, 'activityHealth').doc('worker').set(health); }
  async health(guildId: string): Promise<ActivityHealth | null> { return (await this.collection(guildId, 'activityHealth').doc('worker').get()).data() as ActivityHealth | undefined ?? null; }
  async cleanupReceipts(guildId: string): Promise<void> {
    const expired = await this.collection(guildId, 'activityBatches').where('expiresAt', '<', Timestamp.now()).limit(100).get();
    if (expired.empty) return;
    const batch = this.db.batch();
    expired.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}
