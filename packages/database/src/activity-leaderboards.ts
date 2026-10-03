import { AggregateField, FieldPath, type DocumentData, type Query } from 'firebase-admin/firestore';
import { activityGameKeySchema, activityMetricSchema, activityPeriodSchema, snowflakeSchema, type ActivitySettings } from '@scrt/validation';
import { activityContributionPercent, activityDate, activityPeriodStart, activityStreakEpoch, currentActivityStreak, shiftActivityDate, type ActivityGamePlayerSummary, type ActivityGameSummary, type ActivityLeaderboardEntry, type ActivityMemberSummary, type ActivityMetric, type ActivityPeriod, type ActivityProfile, type ActivityTotals } from '@scrt/shared';
import { ActivityRepository, activityKey, counter } from './activity-repository';

const emptyTotals = (): ActivityTotals => ({ messages: 0, voiceSeconds: 0, streamSeconds: 0 });
const totals = (data: DocumentData): ActivityTotals => ({ messages: counter(data.messages), voiceSeconds: counter(data.voiceSeconds), streamSeconds: counter(data.streamSeconds) });
const rowLimit = 20000;
export class ActivityLeaderboardService {
  private readonly settingsReads = new Map<string, Promise<ActivitySettings>>();
  private readonly gameReads = new Map<string, Promise<ActivityGameSummary | null>>();
  private readonly dailyReads = new Map<string, Promise<DocumentData[]>>();
  private readonly now: () => number;
  constructor(private readonly repository: ActivityRepository, now: () => number = Date.now) {
    // A request crossing guild midnight must keep numerator and denominator in the same window.
    const observedAt = now();
    this.now = () => observedAt;
  }
  /** Instantiate per dashboard request; no authorization or data lives in a process-wide cache. */
  getSettings(guildId: string) {
    let read = this.settingsReads.get(guildId);
    if (!read) { read = this.repository.getSettings(guildId); this.settingsReads.set(guildId, read); }
    return read;
  }
  private limit(value: number) { if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error('Invalid leaderboard limit'); return value; }
  private async bounded(query: Query): Promise<DocumentData[]> {
    const docs = await query.limit(rowLimit + 1).get();
    if (docs.size > rowLimit) throw new Error('За цей період забагато даних для поточного ліміту. Потрібна серверна попередня агрегація.');
    return docs.docs.map((doc) => doc.data());
  }
  private missingIndex(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 9 && 'message' in error && typeof error.message === 'string' && /index/i.test(error.message); }
  private async daily(guildId: string, collection: string, period: ActivityPeriod, query?: (source: Query) => Query): Promise<DocumentData[]> {
    activityPeriodSchema.parse(period);
    const settings = await this.getSettings(guildId);
    const today = activityDate(this.now(), settings.streak.timezone);
    const source: Query = this.repository.collection(guildId, collection).where('date', '>=', activityPeriodStart(period === 'all' ? '30d' : period, today)).where('date', '<=', today);
    if (query) {
      try { return await this.bounded(query(source)); }
      catch (error) {
        if (!this.missingIndex(error)) throw error;
        // Same server-side 30-day cap as the normal path; never return a truncated ranking.
        const rows = await this.daily(guildId, collection, period);
        return rows;
      }
    }
    const key = `${guildId}:${collection}:${period}:${today}`;
    let read = this.dailyReads.get(key);
    if (!read) { read = this.bounded(source); this.dailyReads.set(key, read); }
    return read;
  }
  async memberLeaderboard(guildId: string, metric: ActivityMetric, period: ActivityPeriod, limit = 25): Promise<ActivityLeaderboardEntry[]> {
    activityMetricSchema.parse(metric); activityPeriodSchema.parse(period); this.limit(limit);
    let rows: Array<{ userId: string; value: number }>;
    if (metric === 'currentVoiceStreak') {
      const settings = await this.getSettings(guildId);
      const today = activityDate(this.now(), settings.streak.timezone);
      const dates = [today, shiftActivityDate(today, -1)];
      try {
        const docs = await this.repository.collection(guildId, 'activityMembers').where('streakEpoch', '==', activityStreakEpoch(settings)).where('lastQualifiedVoiceDate', 'in', dates).orderBy(metric, 'desc').limit(limit).get();
        rows = docs.docs.map((doc) => ({ userId: doc.id, value: counter(doc.get(metric)) }));
      } catch (error) {
        if (!this.missingIndex(error)) throw error;
        rows = (await this.bounded(this.repository.collection(guildId, 'activityMembers').where('lastQualifiedVoiceDate', 'in', dates))).filter((row) => row.streakEpoch === activityStreakEpoch(settings)).map((row) => ({ userId: String(row.userId), value: counter(row[metric]) }));
      }
    } else if (period === 'all' || metric === 'longestVoiceStreak') {
      const docs = await this.repository.collection(guildId, 'activityMembers').orderBy(metric, 'desc').limit(limit).get();
      rows = docs.docs.map((doc) => ({ userId: doc.id, value: counter(doc.get(metric)) }));
    } else {
      const members = new Map<string, number>();
      for (const row of await this.daily(guildId, 'activityDailyMembers', period)) members.set(String(row.userId), (members.get(String(row.userId)) ?? 0) + counter(row[metric]));
      rows = [...members].map(([userId, value]) => ({ userId, value }));
    }
    return rows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value || b.userId.localeCompare(a.userId)).slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
  }
  private async memberRows(guildId: string, period: ActivityPeriod): Promise<DocumentData[]> {
    activityPeriodSchema.parse(period);
    return period === 'all' ? this.bounded(this.repository.collection(guildId, 'activityMembers')) : this.daily(guildId, 'activityDailyMembers', period);
  }
  async overview(guildId: string, period: ActivityPeriod): Promise<ActivityTotals & { activeMembers: number }> {
    const rows = await this.memberRows(guildId, period);
    const result = emptyTotals();
    const active = new Set<string>();
    // Game-only members are excluded: member aggregates do not carry game seconds.
    for (const row of rows) {
      const value = totals(row);
      result.messages += value.messages; result.voiceSeconds += value.voiceSeconds; result.streamSeconds += value.streamSeconds;
      if (value.messages > 0 || value.voiceSeconds > 0 || value.streamSeconds > 0) active.add(String(row.userId));
    }
    return { ...result, activeMembers: active.size };
  }
  async messageSummary(guildId: string, period: ActivityPeriod) {
    const rows = await this.memberRows(guildId, period);
    const messages = rows.reduce((sum, row) => sum + counter(row.messages), 0);
    const authors = new Set(rows.filter((row) => counter(row.messages) > 0).map((row) => String(row.userId))).size;
    return { messages, authors, average: authors ? messages / authors : 0 };
  }
  async voiceSummary(guildId: string, period: ActivityPeriod) {
    const rows = await this.memberRows(guildId, period);
    return {
      voiceSeconds: rows.reduce((sum, row) => sum + counter(row.voiceSeconds), 0),
      streamSeconds: rows.reduce((sum, row) => sum + counter(row.streamSeconds), 0),
      participants: new Set(rows.filter((row) => counter(row.voiceSeconds) > 0 || counter(row.streamSeconds) > 0).map((row) => String(row.userId))).size,
    };
  }
  /** Equality filters merge automatic indexes; never scan unrelated games or dates. */
  private async gameDaily(guildId: string, collection: string, gameKey: string, period: Exclude<ActivityPeriod, 'all'>): Promise<DocumentData[]> {
    const settings = await this.getSettings(guildId);
    const today = activityDate(this.now(), settings.streak.timezone);
    const key = JSON.stringify([guildId, collection, gameKey, period, today]);
    let read = this.dailyReads.get(key);
    if (!read) {
      const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
      const dates = Array.from({ length: days }, (_, offset) => shiftActivityDate(today, -offset));
      read = this.bounded(this.repository.collection(guildId, collection).where('gameKey', '==', gameKey).where('date', 'in', dates));
      this.dailyReads.set(key, read);
    }
    return read;
  }
  async messageTotals(guildId: string): Promise<Record<ActivityPeriod, number>> {
    const [settings, rows, all] = await Promise.all([
      this.getSettings(guildId), this.daily(guildId, 'activityDailyMembers', '30d'),
      this.repository.collection(guildId, 'activityMembers').aggregate({ messages: AggregateField.sum('messages') }).get(),
    ]);
    const today = activityDate(this.now(), settings.streak.timezone);
    const week = activityPeriodStart('7d', today);
    const result = { today: 0, '7d': 0, '30d': 0, all: counter(all.data().messages) };
    for (const row of rows) {
      const messages = counter(row.messages);
      result['30d'] += messages;
      if (String(row.date) >= week) result['7d'] += messages;
      if (row.date === today) result.today += messages;
    }
    return result;
  }
  async member(guildId: string, userId: string, period: ActivityPeriod): Promise<ActivityMemberSummary> {
    snowflakeSchema.parse(userId); activityPeriodSchema.parse(period);
    const [snapshot, settings, daily] = await Promise.all([
      this.repository.collection(guildId, 'activityMembers').doc(userId).get(), this.getSettings(guildId),
      period === 'all' ? Promise.resolve([]) : this.daily(guildId, 'activityDailyMembers', period, (q) => q.where('userId', '==', userId)),
    ]);
    const all = snapshot.data() ?? {};
    let values = totals(all);
    if (period !== 'all') {
      values = emptyTotals();
      for (const row of daily) {
        if (row.userId !== userId) continue;
        const value = totals(row); values.messages += value.messages; values.voiceSeconds += value.voiceSeconds; values.streamSeconds += value.streamSeconds;
      }
    }
    const date = typeof all.lastQualifiedVoiceDate === 'string' ? all.lastQualifiedVoiceDate : null;
    const matchingEpoch = all.streakEpoch === activityStreakEpoch(settings);
    return { ...values, userId, currentVoiceStreak: matchingEpoch ? currentActivityStreak(counter(all.currentVoiceStreak), date, activityDate(this.now(), settings.streak.timezone)) : 0, longestVoiceStreak: counter(all.longestVoiceStreak), lastQualifiedVoiceDate: date, lastActivityAt: counter(all.lastActivityAt) };
  }
  async games(guildId: string, period: ActivityPeriod, limit = 25): Promise<ActivityGameSummary[]> {
    activityPeriodSchema.parse(period); this.limit(limit);
    const ignored = new Set((await this.getSettings(guildId)).games.ignoredGameKeys);
    if (period === 'all') {
      const docs = await this.repository.collection(guildId, 'activityGames').orderBy('totalSeconds', 'desc').limit(limit + ignored.size).get();
      return docs.docs.map((doc) => this.gameModel(doc.data())).filter((game) => !ignored.has(game.gameKey) && game.totalSeconds > 0).slice(0, limit);
    }
    const games = new Map<string, ActivityGameSummary>();
    for (const row of await this.daily(guildId, 'activityDailyGames', period)) {
      if (ignored.has(String(row.gameKey))) continue;
      const previous = games.get(String(row.gameKey)) ?? { ...this.gameModel(row), totalSeconds: 0, sessionCount: 0, uniquePlayers: 0 };
      previous.totalSeconds += counter(row.totalSeconds); previous.sessionCount += counter(row.sessionCount); previous.lastPlayedAt = Math.max(previous.lastPlayedAt, counter(row.lastPlayedAt));
      games.set(previous.gameKey, previous);
    }
    const ranked = [...games.values()].sort((a, b) => b.totalSeconds - a.totalSeconds || a.gameKey.localeCompare(b.gameKey)).slice(0, limit);
    if (ranked.length) {
      const [rows, canonical] = await Promise.all([
        Promise.all(Array.from({ length: Math.ceil(ranked.length / 30) }, (_, index) => this.daily(guildId, 'activityDailyGameMembers', period, (q) => q.where('gameKey', 'in', ranked.slice(index * 30, index * 30 + 30).map((game) => game.gameKey))))).then((groups) => groups.flat()),
        this.repository.db.getAll(...ranked.map((game) => this.repository.collection(guildId, 'activityGames').doc(activityKey(game.gameKey)))),
      ]);
      const players = new Map<string, Set<string>>();
      for (const row of rows) {
        const key = String(row.gameKey);
        let members = players.get(key);
        if (!members) { members = new Set(); players.set(key, members); }
        members.add(String(row.userId));
      }
      for (const [index, game] of ranked.entries()) {
        game.uniquePlayers = players.get(game.gameKey)?.size ?? 0;
        game.displayName = canonical[index]?.get('displayName') as string ?? game.displayName;
      }
    }
    return ranked;
  }
  private gameModel(row: DocumentData): ActivityGameSummary {
    return { gameKey: String(row.gameKey), displayName: String(row.displayName), applicationId: typeof row.applicationId === 'string' ? row.applicationId : null, totalSeconds: counter(row.totalSeconds), sessionCount: counter(row.sessionCount), uniquePlayers: counter(row.uniquePlayers), lastPlayedAt: counter(row.lastPlayedAt) };
  }
  async game(guildId: string, gameKey: string, period: ActivityPeriod = 'all'): Promise<ActivityGameSummary | null> {
    activityGameKeySchema.parse(gameKey); activityPeriodSchema.parse(period);
    const key = JSON.stringify([guildId, gameKey, period]);
    let read = this.gameReads.get(key);
    if (!read) { read = this.gameSummary(guildId, gameKey, period); this.gameReads.set(key, read); }
    return read;
  }
  private async gameSummary(guildId: string, gameKey: string, period: ActivityPeriod): Promise<ActivityGameSummary | null> {
    if ((await this.getSettings(guildId)).games.ignoredGameKeys.includes(gameKey)) return null;
    const doc = await this.repository.collection(guildId, 'activityGames').doc(activityKey(gameKey)).get();
    if (!doc.exists) return null;
    const canonical = this.gameModel(doc.data()!);
    if (period === 'all') return canonical;
    const [games, players] = await Promise.all([
      this.gameDaily(guildId, 'activityDailyGames', gameKey, period),
      this.gameDaily(guildId, 'activityDailyGameMembers', gameKey, period),
    ]);
    return { ...canonical,
      totalSeconds: games.reduce((sum, row) => sum + counter(row.totalSeconds), 0),
      sessionCount: games.reduce((sum, row) => sum + counter(row.sessionCount), 0),
      uniquePlayers: new Set(players.filter((row) => counter(row.totalSeconds) > 0).map((row) => String(row.userId))).size,
      lastPlayedAt: games.reduce((last, row) => Math.max(last, counter(row.lastPlayedAt)), 0),
    };
  }
  async gamePlayers(guildId: string, gameKey: string, period: ActivityPeriod, limit = 25): Promise<ActivityGamePlayerSummary[]> {
    activityPeriodSchema.parse(period); activityGameKeySchema.parse(gameKey); this.limit(limit);
    const game = await this.game(guildId, gameKey, period);
    if (!game) return [];
    const rows = period === 'all'
      ? await this.bounded(this.repository.collection(guildId, 'activityGameMembers').where('gameKey', '==', gameKey))
      : await this.gameDaily(guildId, 'activityDailyGameMembers', gameKey, period);
    const players = new Map<string, ActivityGamePlayerSummary>();
    for (const row of rows) {
      const previous = players.get(String(row.userId)) ?? { userId: String(row.userId), totalSeconds: 0, sessionCount: 0, lastPlayedAt: 0, contributionPercent: 0 };
      previous.totalSeconds += counter(row.totalSeconds); previous.sessionCount += counter(row.sessionCount); previous.lastPlayedAt = Math.max(previous.lastPlayedAt, counter(row.lastPlayedAt));
      players.set(previous.userId, previous);
    }
    return [...players.values()].filter((row) => row.totalSeconds > 0).sort((a, b) => b.totalSeconds - a.totalSeconds || b.userId.localeCompare(a.userId)).slice(0, limit).map((row) => ({ ...row, contributionPercent: activityContributionPercent(row.totalSeconds, game.totalSeconds) }));
  }
  async observedGames(guildId: string, after?: string): Promise<{ games: ActivityGameSummary[]; next: string | null }> {
    let query: Query = this.repository.collection(guildId, 'activityGames').orderBy(FieldPath.documentId());
    if (after) {
      if (!/^[a-f0-9]{64}$/.test(after)) throw new Error('Invalid activity cursor');
      query = query.startAfter(after);
    }
    const docs = await query.limit(51).get();
    return { games: docs.docs.slice(0, 50).map((doc) => this.gameModel(doc.data())), next: docs.size > 50 ? docs.docs[49]!.id : null };
  }
  async memberGames(guildId: string, userId: string, period: ActivityPeriod): Promise<ActivityGameSummary[]> {
    snowflakeSchema.parse(userId); activityPeriodSchema.parse(period);
    let rows: DocumentData[];
    if (period === 'all') {
      const query = this.repository.collection(guildId, 'activityGameMembers').where('userId', '==', userId);
      try { rows = await this.bounded(query.orderBy('totalSeconds', 'desc')); }
      catch (error) { if (!this.missingIndex(error)) throw error; rows = await this.bounded(query); }
    } else rows = await this.daily(guildId, 'activityDailyGameMembers', period, (q) => q.where('userId', '==', userId));
    const ignored = new Set((await this.getSettings(guildId)).games.ignoredGameKeys);
    const games = new Map<string, ActivityGameSummary>();
    for (const row of rows) { if (ignored.has(String(row.gameKey)) || row.userId !== userId) continue; const previous = games.get(String(row.gameKey)) ?? { ...this.gameModel(row), totalSeconds: 0, sessionCount: 0, uniquePlayers: 1 }; previous.totalSeconds += counter(row.totalSeconds); previous.sessionCount += counter(row.sessionCount); previous.lastPlayedAt = Math.max(previous.lastPlayedAt, counter(row.lastPlayedAt)); games.set(previous.gameKey, previous); }
    const visible = [...games.values()];
    const total = visible.reduce((sum, game) => sum + game.totalSeconds, 0);
    return visible.sort((a, b) => b.totalSeconds - a.totalSeconds || a.gameKey.localeCompare(b.gameKey)).slice(0, 25).map((game) => ({ ...game, activityPercent: activityContributionPercent(game.totalSeconds, total) }));
  }
  async directory(guildId: string, search: string, after?: string): Promise<{ profiles: ActivityProfile[]; next: string | null }> {
    if (search.length > 64) throw new Error('Пошуковий запит задовгий.');
    let query: Query = this.repository.collection(guildId, 'activityProfiles');
    const value = search.normalize('NFKC').trim().toLocaleLowerCase('uk-UA');
    if (value) query = query.where('searchPrefixes', 'array-contains', value);
    query = query.orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(snowflakeSchema.parse(after));
    const docs = await query.limit(26).get();
    const profiles = docs.docs.slice(0, 25).map((doc) => {
      const row = doc.data();
      return { userId: doc.id, displayName: String(row.displayName), username: String(row.username), avatarUrl: String(row.avatarUrl), searchName: String(row.searchName), updatedAt: counter(row.updatedAt) };
    });
    return { profiles, next: docs.size > 25 ? profiles.at(-1)!.userId : null };
  }
}
