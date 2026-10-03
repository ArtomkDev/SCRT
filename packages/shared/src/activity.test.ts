import { describe, expect, it } from 'vitest';
import { activityDate, activityPeriodStart, currentActivityStreak, formatActivityDuration, normalizeGame, qualifyVoiceDate, splitActivityDuration } from './activity';

describe('guild calendar duration splitting', () => {
  it('splits same-day and zero-duration sessions', () => {
    const start = Date.parse('2026-10-01T10:00:00Z');
    expect(splitActivityDuration(start, start + 60_000, 'Europe/Kyiv')).toEqual([{ date: '2026-10-01', seconds: 60 }]);
    expect(splitActivityDuration(start, start, 'Europe/Kyiv')).toEqual([]);
  });
  it('splits midnight in the guild timezone', () => {
    expect(splitActivityDuration(Date.parse('2026-10-01T20:30:00Z'), Date.parse('2026-10-01T22:30:00Z'), 'Europe/Kyiv')).toEqual([{ date: '2026-10-01', seconds: 1800 }, { date: '2026-10-02', seconds: 5400 }]);
  });
  it.each([
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', '2026-03-08', 23 * 3600],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', '2026-11-01', 25 * 3600],
  ])('uses actual DST day length: %s', (start, end, date, seconds) => {
    expect(splitActivityDuration(Date.parse(start), Date.parse(end), 'America/New_York')).toEqual([{ date, seconds }]);
  });
  it('splits multiple days and preserves fractional seconds', () => {
    const slices = splitActivityDuration(Date.parse('2026-10-01T23:59:59.500Z'), Date.parse('2026-10-04T00:00:00.500Z'), 'UTC');
    expect(slices.map((slice) => slice.seconds)).toEqual([0.5, 86400, 86400, 0.5]);
    expect(slices.reduce((sum, slice) => sum + slice.seconds, 0)).toBe(172801);
  });
  it('defines 7d/30d using calendar days', () => {
    expect(activityDate(Date.parse('2026-09-30T22:00:00Z'), 'Europe/Kyiv')).toBe('2026-10-01');
    expect(activityPeriodStart('7d', '2026-10-01')).toBe('2026-09-25');
    expect(activityPeriodStart('30d', '2026-10-01')).toBe('2026-09-02');
  });
});
describe('voice streak policy', () => {
  it('qualifies once, increments yesterday, resets missed days and preserves longest', () => {
    const first = qualifyVoiceDate(0, 5, null, '2026-09-30');
    expect(first.currentVoiceStreak).toBe(1);
    expect(qualifyVoiceDate(1, 5, '2026-09-30', '2026-09-30')).toEqual(first);
    expect(qualifyVoiceDate(1, 5, '2026-09-30', '2026-10-01').currentVoiceStreak).toBe(2);
    expect(qualifyVoiceDate(2, 5, '2026-09-30', '2026-10-02').currentVoiceStreak).toBe(1);
    expect(qualifyVoiceDate(5, 5, '2026-09-30', '2026-10-01').longestVoiceStreak).toBe(6);
    expect(currentActivityStreak(7, '2026-09-28', '2026-10-01')).toBe(0);
    expect(currentActivityStreak(7, '2026-09-30', '2026-10-01')).toBe(7);
  });
});
describe('presentation and game identity', () => {
  it('prefers application identity, normalizes names without fuzzy merging', () => {
    expect(normalizeGame('  ＧＴＡ   V ', null)?.gameKey).toBe('name:gta v');
    expect(normalizeGame('GTA V', '12345678901234567')?.gameKey).toBe('app:12345678901234567');
    expect(normalizeGame('GTA V Enhanced', null)?.gameKey).not.toBe(normalizeGame('GTA V', null)?.gameKey);
    expect(normalizeGame(' ', null)).toBeNull();
  });
  it.each([[45, '45 с'], [720, '12 хв'], [4080, '1 год 8 хв'], [453600, '126 год']])('formats %d seconds', (seconds, expected) => expect(formatActivityDuration(seconds)).toBe(expected));
});

describe('canonical analytics presentation', () => {
  it('shares period labels, metric semantics, percentages and duration formatting', async () => {
    const { activityPeriods, activityMetrics, activityContributionPercent, formatActivityDuration, formatActivityRelativeDay } = await import('./activity');
    expect(activityPeriods.map(([, label]) => label)).toEqual(['Сьогодні', '7 днів', '30 днів', 'Увесь час']);
    expect(Object.values(activityMetrics).map((metric) => metric.label)).toEqual(['Повідомлення', 'Voice', 'Демонстрація екрана', 'Поточна серія', 'Найдовша серія']);
    expect(activityMetrics.currentVoiceStreak.periodAware).toBe(false);
    expect(activityMetrics.longestVoiceStreak.periodAware).toBe(false);
    expect(activityMetrics.messages.periodAware).toBe(true);
    expect(activityMetrics.voiceSeconds.periodAware).toBe(true);
    expect(activityMetrics.streamSeconds.periodAware).toBe(true);
    expect(activityContributionPercent(5, 0)).toBe(0);
    expect(activityContributionPercent(25, 100)).toBe(25);
    expect([45, 300, 4080, 43440, 453600].map(formatActivityDuration)).toEqual(['45 с', '5 хв', '1 год 8 хв', '12 год 4 хв', '126 год']);
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(formatActivityRelativeDay(now, 'Europe/Kyiv', now)).toBe('сьогодні');
    expect(formatActivityRelativeDay(now - 86400000, 'Europe/Kyiv', now)).toBe('вчора');
    expect(formatActivityRelativeDay(now - 2 * 86400000, 'Europe/Kyiv', now)).toBe('2 дні тому');
  });
});
