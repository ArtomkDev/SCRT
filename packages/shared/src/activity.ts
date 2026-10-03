export type ActivityPeriod = 'today' | '7d' | '30d' | 'all';
export type ActivityMetric = 'messages' | 'voiceSeconds' | 'streamSeconds' | 'currentVoiceStreak' | 'longestVoiceStreak';
export type ActivityTotals = { messages: number; voiceSeconds: number; streamSeconds: number };
export type ActivityMemberSummary = ActivityTotals & { userId: string; currentVoiceStreak: number; longestVoiceStreak: number; lastQualifiedVoiceDate: string | null; lastActivityAt: number };
export type ActivityLeaderboardEntry = { userId: string; value: number; rank: number };
export type ActivityGameSummary = { gameKey: string; displayName: string; applicationId: string | null; totalSeconds: number; sessionCount: number; uniquePlayers: number; lastPlayedAt: number; activityPercent?: number };
export type ActivityGamePlayerSummary = { userId: string; totalSeconds: number; sessionCount: number; lastPlayedAt: number; contributionPercent: number };
export type ActivityProfile = { userId: string; displayName: string; username: string; avatarUrl: string; searchName: string; updatedAt: number };
export function activityStreakEpoch(settings: { streak: { timezone: string; minimumVoiceSecondsPerDay: number }; tracking: { voiceStreaks: boolean }; streakRevision: number }): string {
  return `${settings.streak.timezone}:${settings.streak.minimumVoiceSecondsPerDay}:${settings.tracking.voiceStreaks}:${settings.streakRevision}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function activityDate(timestamp: number, timezone: string): string {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(timestamp);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}
export function shiftActivityDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function formatActivityDay(timestamp: number, timezone: string): string {
  return activityDate(timestamp, timezone).split('-').reverse().join('.');
}
export function activityPeriodStart(period: Exclude<ActivityPeriod, 'all'>, today: string): string {
  return shiftActivityDate(today, period === '7d' ? -6 : period === '30d' ? -29 : 0);
}
/** Search real instants for the next calendar boundary; handles 23/25-hour DST days. */
export function splitActivityDuration(start: number, end: number, timezone: string): Array<{ date: string; seconds: number }> {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Invalid activity timestamp');
  if (end <= start) return [];
  const slices: Array<{ date: string; seconds: number }> = [];
  let cursor = start;
  while (cursor < end) {
    if (slices.length >= 100) throw new Error('Activity segment exceeds 100 calendar days');
    const date = activityDate(cursor, timezone);
    let boundary = end;
    if (activityDate(end - 1, timezone) !== date) {
      let low = cursor;
      let high = Math.min(end, cursor + 36 * 3600_000);
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (activityDate(mid, timezone) === date) low = mid; else high = mid;
      }
      boundary = high;
    }
    slices.push({ date, seconds: (boundary - cursor) / 1000 });
    cursor = boundary;
  }
  return slices;
}
export function currentActivityStreak(current: number, last: string | null, today: string): number {
  return last === today || last === shiftActivityDate(today, -1) ? current : 0;
}
export function qualifyVoiceDate(current: number, longest: number, last: string | null, date: string) {
  if (last && date <= last) return { currentVoiceStreak: current, longestVoiceStreak: longest, lastQualifiedVoiceDate: last };
  const next = last === shiftActivityDate(date, -1) ? current + 1 : 1;
  return { currentVoiceStreak: next, longestVoiceStreak: Math.max(longest, next), lastQualifiedVoiceDate: date };
}
export function formatActivityDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value} с`;
  if (value < 3600) return `${Math.floor(value / 60)} хв`;
  const minutes = Math.floor(value % 3600 / 60);
  return `${Math.floor(value / 3600).toLocaleString('uk-UA')} год${minutes ? ` ${minutes} хв` : ''}`;
}
export function normalizeGame(name: string, applicationId: string | null) {
  const displayName = name.normalize('NFKC').trim().replace(/\s+/gu, ' ').slice(0, 128);
  if (!displayName) return null;
  return { gameKey: applicationId ? `app:${applicationId}` : `name:${displayName.toLocaleLowerCase('en-US')}`, displayName, applicationId };
}

export const activityPeriods = [
  ['today', 'Сьогодні'], ['7d', '7 днів'], ['30d', '30 днів'], ['all', 'Увесь час'],
] as const;
export const activityMetrics = {
  messages: { label: 'Повідомлення', periodAware: true },
  voiceSeconds: { label: 'Voice', periodAware: true },
  streamSeconds: { label: 'Демонстрація екрана', periodAware: true },
  currentVoiceStreak: { label: 'Поточна серія', periodAware: false },
  longestVoiceStreak: { label: 'Найдовша серія', periodAware: false },
} as const satisfies Record<ActivityMetric, { label: string; periodAware: boolean }>;
export function activityContributionPercent(seconds: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, seconds / total * 100)) : 0;
}
export function formatActivityRelativeDay(timestamp: number, timezone: string, now: number): string {
  if (!timestamp) return 'Ще немає';
  const date = activityDate(timestamp, timezone);
  const today = activityDate(now, timezone);
  if (date === today) return 'сьогодні';
  if (date === shiftActivityDate(today, -1)) return 'вчора';
  for (let days = 2; days <= 4; days++) if (date === shiftActivityDate(today, -days)) return `${days} дні тому`;
  return formatActivityDay(timestamp, timezone);
}
