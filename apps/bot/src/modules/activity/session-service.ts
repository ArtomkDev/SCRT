import { randomUUID } from 'node:crypto';
import type { ActivityRepository } from '@scrt/database';
import type { ActivitySession, ActivitySettings } from '@scrt/validation';
import { activityStreakEpoch } from '@scrt/shared';

type SessionStore = Pick<ActivityRepository, 'startSession' | 'settleSession' | 'listSessions'>;
export type DesiredSession = { tracker: ActivitySession['tracker']; channelId: string | null; game: ActivitySession['game'] };
type PendingSession = { session: ActivitySession; started: boolean; closeAt: number | null };
export class ActivitySessionService {
  private readonly active = new Map<string, PendingSession>();
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly repository: SessionStore) {}
  private key(session: Pick<ActivitySession, 'guildId' | 'userId' | 'tracker' | 'game'>) { return `${session.guildId}:${session.userId}:${session.tracker}:${session.game?.gameKey ?? ''}`; }
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
  private minimum(settings: ActivitySettings, tracker: ActivitySession['tracker']) { return tracker === 'voice' ? settings.voice.minimumSessionSeconds : tracker === 'stream' ? settings.streaming.minimumSessionSeconds : settings.games.minimumSessionSeconds; }
  async reconcile(guildId: string, userId: string, desired: DesiredSession[], settings: ActivitySettings, now: number): Promise<void> {
    const wanted = new Map(desired.map((item) => [this.key({ guildId, userId, ...item }), item]));
    const epoch = activityStreakEpoch(settings);
    for (const session of this.sessions(guildId).filter((session) => session.userId === userId)) {
      const key = this.key(session);
      const entry = this.active.get(key)!;
      if (!wanted.has(key) || session.timezone !== settings.streak.timezone || session.minimumSeconds !== this.minimum(settings, session.tracker) || session.streakEpoch !== epoch || entry.closeAt !== null) {
        entry.closeAt ??= now;
        if (!entry.started) { await this.repository.startSession(entry.session); entry.started = true; }
        await this.repository.settleSession(guildId, session.id, entry.closeAt, true);
        this.active.delete(key);
      }
    }
    for (const [key, item] of wanted) {
      let entry = this.active.get(key);
      if (!entry) {
        entry = { started: false, closeAt: null, session: { ...item, id: randomUUID(), guildId, userId, startedAt: now, cursorAt: now, lastObservedAt: now, qualified: false, timezone: settings.streak.timezone, minimumSeconds: this.minimum(settings, item.tracker), streakMinimum: settings.tracking.voiceStreaks ? settings.streak.minimumVoiceSecondsPerDay : null, streakEpoch: epoch, schemaVersion: 1 } };
        this.active.set(key, entry);
      }
      if (!entry.started) { await this.repository.startSession(entry.session); entry.started = true; }
      // Eligible channel moves are continuous and do not produce writes by themselves.
      entry.session.channelId = item.channelId;
      entry.session.lastObservedAt = now;
    }
  }
  async checkpoint(guildId: string, now: number): Promise<void> {
    for (const session of this.sessions(guildId)) await this.exclusive(guildId, session.userId, async () => {
      const entry = this.active.get(this.key(session));
      if (!entry) return;
      if (!entry.started) { await this.repository.startSession(entry.session); entry.started = true; }
      const next = await this.repository.settleSession(guildId, session.id, entry.closeAt ?? now, entry.closeAt !== null);
      if (next) entry.session = next; else this.active.delete(this.key(session));
    });
  }
  async recover(guildId: string): Promise<void> {
    for (const session of this.sessions(guildId)) this.active.delete(this.key(session));
    for (const persisted of await this.repository.listSessions(guildId)) await this.exclusive(guildId, persisted.userId, async () => {
      const key = this.key(persisted);
      // Never invent activity between the last durable observation and startup.
      await this.repository.settleSession(guildId, persisted.id, persisted.lastObservedAt, true);
      this.active.delete(key);
    });
  }
  async suspend(guildId: string): Promise<void> {
    for (const session of this.sessions(guildId)) await this.exclusive(guildId, session.userId, async () => {
      const entry = this.active.get(this.key(session));
      if (!entry) return;
      if (!entry.started) await this.repository.startSession(entry.session);
      await this.repository.settleSession(guildId, session.id, entry.session.lastObservedAt, true);
      this.active.delete(this.key(session));
    });
  }
}
