import { describe, expect, it } from 'vitest';
import { activitySettingsSchema, activityTimezoneSchema } from './activity';
describe('activity configuration', () => {
  it('is disabled by default with human-only safe thresholds', () => {
    const settings = activitySettingsSchema.parse({});
    expect(settings.enabled).toBe(false);
    expect(settings.exclusions.ignoreBots).toBe(true);
    expect(settings.voice.minimumSessionSeconds).toBe(60);
    expect(settings.voice.returnGraceSeconds).toBe(60);
    expect(settings.streak.minimumVoiceSecondsPerDay).toBe(300);
  });
  it('supports legacy settings and a bounded, optional voice return window', () => {
    expect(activitySettingsSchema.parse({ voice: { minimumSessionSeconds: 120 } }).voice.returnGraceSeconds).toBe(60);
    for (const returnGraceSeconds of [0, 30, 86400]) expect(activitySettingsSchema.parse({ voice: { returnGraceSeconds } }).voice.returnGraceSeconds).toBe(returnGraceSeconds);
    for (const returnGraceSeconds of [-1, 86401, 1.5, '60']) expect(activitySettingsSchema.safeParse({ voice: { returnGraceSeconds } }).success).toBe(false);
  });
  it('validates timezone, bounded exclusions and thresholds', () => {
    expect(activityTimezoneSchema.safeParse('Europe/Kyiv').success).toBe(true);
    expect(activityTimezoneSchema.safeParse('not/a/timezone').success).toBe(false);
    expect(activitySettingsSchema.safeParse({ voice: { minimumSessionSeconds: 0 } }).success).toBe(false);
    expect(activitySettingsSchema.safeParse({ exclusions: { channelIds: ['../../otherGuild'] } }).success).toBe(false);
    expect(activitySettingsSchema.safeParse({ exclusions: { userIds: Array(101).fill('12345678901234567') } }).success).toBe(false);
    expect(activitySettingsSchema.safeParse({ exclusions: { ignoreBots: false } }).success).toBe(false);
  });
});

it('defaults legacy application exclusions and rejects noncanonical, oversized keys', async () => {
  const { activitySettingsSchema, activityGameKeySchema } = await import('./activity');
  expect(activitySettingsSchema.parse({ games: { minimumSessionSeconds: 60 } }).games.ignoredGameKeys).toEqual([]);
  const games = activitySettingsSchema.parse({ games: { ignoredGameKeys: ['name:visual studio code', 'name:visual studio code'] } }).games;
  expect(games.ignoredGameKeys).toEqual(['name:visual studio code']);
  for (const key of ['../other', 'name:', 'app:123', 'name:' + 'a'.repeat(200)]) expect(activityGameKeySchema.safeParse(key).success).toBe(false);
});
