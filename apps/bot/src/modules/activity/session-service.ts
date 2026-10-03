import { randomUUID } from 'node:crypto';
import type { ActivityRepository } from '@scrt/database';
import type { ActivitySession, ActivitySettings } from '@scrt/validation';
import { activityStreakEpoch } from '@scrt/shared';

type SessionStore = Pick<ActivityRepository, 'startSession' | 'settleSession' | 'listSessions'>;
export type DesiredSession = { tracker: ActivitySession['tracker']; channelId: string | null; game: ActivitySession['game'] };
type PendingSession = { session: ActivitySession; started: boolean; closeAt: number | null; returnSeconds: number };
type VoiceReturn = { epoch: string; leftAt: number; until: number };
export class ActivitySessionService {
  private readonly active = new Map<string, PendingSession>();
  private readonly memberSessions = new Map<string, Set<string>>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly voiceReturns = new Map<string, VoiceReturn>();
  constructor(private readonly repository: SessionStore) {}
  private key(session: Pick<ActivitySession, 'guildId' | 'userId' | 'tracker' | 'game'>) { return `${session.guildId}:${session.userId}:${session.tracker}:${session.game?.gameKey ?? ''}`; }
  private memberKey(guildId: string, userId: string) { return `${guildId}:${userId}`; }
  private remember(key: string, entry: PendingSession): void {
    this.active.set(key, entry);
    const memberKey = this.memberKey(entry.session.guildId, entry.session.userId);
    const keys = this.memberSessions.get(memberKey) ?? new Set<string>();
    keys.add(key);
    this.memberSessions.set(memberKey, keys);
  }
  private forget(key: string): void {
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    const memberKey = this.memberKey(entry.session.guildId, entry.session.userId);
    const keys = this.memberSessions.get(memberKey);
    keys?.delete(key);
    if (!keys?.size) this.memberSessions.delete(memberKey);
  }
  async exclusive<T>(guildId: string, userId: string, work: () => Promise<T>): Promise<T> {
    const key = `${guildId}:${userId}`;
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, pending);
    await prior;
    try { return await work(); } finally { release(); if (this.locks.get(key) === pending) this.locks.delete(key); }
  }
  async drain(guildId?: string): Promise<void> { await Promise.all([...this.locks].filter(([key]) => !guildId || key.startsWith(`${guildId}:`)).map(([, pending]) => pending)); }
  sessions(guildId?: string): ActivitySession[] { return [...this.active.values()].map((entry) => entry.session).filter((session) => !guildId || session.guildId === guildId); }
  hasSessions(guildId: string, userId: string): boolean { return this.memberSessions.has(this.memberKey(guildId, userId)); }
  private sessionsForMember(guildId: string, userId: string): ActivitySession[] {
    return [...this.memberSessions.get(this.memberKey(guildId, userId)) ?? []].map((key) => this.active.get(key)!.session);
  }
  hasVoiceReturn(guildId: string, userId: string): boolean { return this.voiceReturns.has(this.key({ guildId, userId, tracker: 'voice', game: null })); }
  users(guildId: string): string[] { return [...new Set([...this.sessions(guildId).map((session) => session.userId), ...[...this.voiceReturns.keys()].filter((key) => key.startsWith(`${guildId}:`)).map((key) => key.split(':')[1]!)])]; }
  private minimum(settings: ActivitySettings, tracker: ActivitySession['tracker']) { return tracker === 'voice' ? settings.voice.minimumSessionSeconds : tracker === 'stream' ? settings.streaming.minimumSessionSeconds : settings.games.minimumSessionSeconds; }
  async reconcile(guildId: string, userId: string, desired: DesiredSession[], settings: ActivitySettings, now: number, voiceContinuity: 'continue' | 'break' = 'break'): Promise<void> {
    const voiceKey = this.key({ guildId, userId, tracker: 'voice', game: null });
    const returning = this.voiceReturns.get(voiceKey);
    if (returning && (voiceContinuity === 'break' || now > returning.until || now - returning.leftAt > settings.voice.returnGraceSeconds * 1000 || settings.voice.returnGraceSeconds === 0)) this.voiceReturns.delete(voiceKey);
    const wanted = new Map(desired.map((item) => [this.key({ guildId, userId, ...item }), item]));
    const epoch = activityStreakEpoch(settings);
    for (const session of this.sessionsForMember(guildId, userId)) {
      const key = this.key(session);
      const entry = this.active.get(key)!;
      if (!wanted.has(key) || session.timezone !== settings.streak.timezone || session.minimumSeconds !== this.minimum(settings, session.tracker) || session.streakEpoch !== epoch || entry.closeAt !== null) {
        if (entry.closeAt === null) {
          entry.closeAt = now;
          entry.returnSeconds = session.tracker === 'voice' && !wanted.has(key) && voiceContinuity === 'continue' ? settings.voice.returnGraceSeconds : 0;
        }
        if (!entry.started) { await this.repository.startSession(entry.session); entry.started = true; }
        await this.close(guildId, key, entry);
        if (voiceContinuity === 'break') this.voiceReturns.delete(voiceKey);
        this.forget(key);
      }
    }
    for (const [key, item] of wanted) {
      let entry = this.active.get(key);
      if (!entry) {
        const pendingReturn = this.voiceReturns.get(voiceKey);
        const withinGrace = pendingReturn && voiceContinuity === 'continue' && settings.voice.returnGraceSeconds > 0 && now >= pendingReturn.leftAt && now <= pendingReturn.until && now - pendingReturn.leftAt <= settings.voice.returnGraceSeconds * 1000;
        const voiceRunEpoch = item.tracker === 'voice' ? withinGrace ? pendingReturn.epoch : randomUUID() : '';
        entry = { started: false, closeAt: null, returnSeconds: 0, session: { ...item, id: randomUUID(), guildId, userId, startedAt: now, cursorAt: now, lastObservedAt: now, qualified: false, timezone: settings.streak.timezone, minimumSeconds: this.minimum(settings, item.tracker), streakMinimum: settings.tracking.voiceStreaks ? settings.streak.minimumVoiceSecondsPerDay : null, streakEpoch: epoch, voiceRunEpoch, voiceRunBaseMilliseconds: 0, schemaVersion: 1 } };
        this.remember(key, entry);
      }
      if (!entry.started) { await this.repository.startSession(entry.session); entry.started = true; }
      if (item.tracker === 'voice') this.voiceReturns.delete(voiceKey);
      // Eligible channel moves are continuous and do not produce writes by themselves.
      entry.session.channelId = item.channelId;
      entry.session.lastObservedAt = now;
    }
  }
  private async close(guildId: string, key: string, entry: PendingSession): Promise<void> {
    await this.repository.settleSession(guildId, entry.session.id, entry.closeAt!, true, entry.returnSeconds);
    if (entry.returnSeconds > 0) this.voiceReturns.set(key, { epoch: entry.session.voiceRunEpoch, leftAt: entry.closeAt!, until: entry.closeAt! + entry.returnSeconds * 1000 });
    else this.voiceReturns.delete(key);
  }
  async checkpoint(guildId: string, now: number): Promise<void> {
    for (const [key, returning] of this.voiceReturns) if (key.startsWith(`${guildId}:`) && now > returning.until) this.voiceReturns.delete(key);
    for (const session of this.sessions(guildId)) await this.exclusive(guildId, session.userId, async () => {
      const entry = this.active.get(this.key(session));
      if (!entry) return;
      if (!entry.started) { await this.repository.startSession(entry.session); entry.started = true; }
      if (entry.closeAt !== null) { await this.close(guildId, this.key(session), entry); this.forget(this.key(session)); return; }
      const next = await this.repository.settleSession(guildId, session.id, now, false);
      if (next) entry.session = next; else this.forget(this.key(session));
    });
  }
  async recover(guildId: string): Promise<void> {
    for (const key of this.voiceReturns.keys()) if (key.startsWith(`${guildId}:`)) this.voiceReturns.delete(key);
    for (const session of this.sessions(guildId)) this.forget(this.key(session));
    for (const persisted of await this.repository.listSessions(guildId)) await this.exclusive(guildId, persisted.userId, async () => {
      const key = this.key(persisted);
      // Never invent activity between the last durable observation and startup.
      await this.repository.settleSession(guildId, persisted.id, persisted.lastObservedAt, true);
      this.forget(key);
    });
  }
  async suspend(guildId: string): Promise<void> {
    for (const key of this.voiceReturns.keys()) if (key.startsWith(`${guildId}:`)) this.voiceReturns.delete(key);
    for (const session of this.sessions(guildId)) await this.exclusive(guildId, session.userId, async () => {
      const entry = this.active.get(this.key(session));
      if (!entry) return;
      if (!entry.started) await this.repository.startSession(entry.session);
      await this.repository.settleSession(guildId, session.id, entry.session.lastObservedAt, true);
      this.forget(this.key(session));
    });
  }
}
