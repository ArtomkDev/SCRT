import { z } from 'zod';

const id = z.string().regex(/^\d{17,20}$/);
export const activityTimezoneSchema = z.string().max(80).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
}, 'Вкажіть чинний часовий пояс IANA.');
export const activityGameKeySchema = z.string().min(1).max(200).refine((value) => /^app:\d{17,20}$/.test(value) || value.startsWith('name:') && value.length > 5, 'Invalid activity key');
const seconds = z.number().int().min(1).max(86400);
const ids = z.array(id).max(100).transform((values) => [...new Set(values)]);
export const activitySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  tracking: z.object({ messages: z.boolean().default(true), voice: z.boolean().default(true), streaming: z.boolean().default(true), games: z.boolean().default(true), voiceStreaks: z.boolean().default(true) }).default({ messages: true, voice: true, streaming: true, games: true, voiceStreaks: true }),
  exclusions: z.object({ channelIds: ids.default([]), categoryIds: ids.default([]), roleIds: ids.default([]), userIds: ids.default([]), ignoreBots: z.literal(true).default(true), ignoreAfkChannel: z.boolean().default(true) }).default({ channelIds: [], categoryIds: [], roleIds: [], userIds: [], ignoreBots: true, ignoreAfkChannel: true }),
  voice: z.object({ minimumSessionSeconds: seconds.default(60), returnGraceSeconds: z.number().int().min(0).max(86400).default(60) }).default({ minimumSessionSeconds: 60, returnGraceSeconds: 60 }),
  streaming: z.object({ minimumSessionSeconds: seconds.default(60) }).default({ minimumSessionSeconds: 60 }),
  games: z.object({ minimumSessionSeconds: seconds.default(60), ignoredGameKeys: z.array(activityGameKeySchema).max(100).transform((values) => [...new Set(values)]).default([]) }).default({ minimumSessionSeconds: 60, ignoredGameKeys: [] }),
  streak: z.object({ minimumVoiceSecondsPerDay: seconds.default(300), timezone: activityTimezoneSchema.default('Europe/Kyiv') }).default({ minimumVoiceSecondsPerDay: 300, timezone: 'Europe/Kyiv' }),
  schemaVersion: z.literal(1).default(1),
  streakRevision: z.number().int().nonnegative().default(0),
});
export type ActivitySettings = z.infer<typeof activitySettingsSchema>;
export const activityPeriodSchema = z.enum(['today', '7d', '30d', 'all']);
export const activityMetricSchema = z.enum(['messages', 'voiceSeconds', 'streamSeconds', 'currentVoiceStreak', 'longestVoiceStreak', 'longestVoiceRunSeconds']);
export const activitySessionSchema = z.object({
  id: z.string().uuid(), guildId: id, userId: id, tracker: z.enum(['voice', 'stream', 'game']),
  channelId: id.nullable(), startedAt: z.number().int().nonnegative(), cursorAt: z.number().int().nonnegative(), lastObservedAt: z.number().int().nonnegative(),
  qualified: z.boolean(), timezone: activityTimezoneSchema, minimumSeconds: seconds,
  streakMinimum: seconds.nullable(), streakEpoch: z.string().max(120),
  voiceRunEpoch: z.string().max(36).default(''), voiceRunBaseMilliseconds: z.number().int().nonnegative().default(0),
  game: z.object({ gameKey: z.string().min(1).max(200), displayName: z.string().min(1).max(128), applicationId: id.nullable() }).nullable(), schemaVersion: z.literal(1),
}).refine((value) => value.cursorAt >= value.startedAt && value.lastObservedAt >= value.cursorAt && (value.tracker === 'game') === (value.game !== null), 'Invalid activity session');
export type ActivitySession = z.infer<typeof activitySessionSchema>;
