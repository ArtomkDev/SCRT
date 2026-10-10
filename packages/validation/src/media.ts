import { z } from 'zod';

// Kept local to avoid an index <-> media initialization cycle.
const snowflake = z.string().regex(/^\d{17,20}$/);
const httpUrl = z.url().max(2048).refine((value) => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; });
export const mediaSettingsSchema = z.object({
  enabled: z.boolean().default(false), controlMode: z.enum(['OPEN', 'QUEUE', 'DJ']).default('QUEUE'),
  allowRemoteAdminControl: z.boolean().default(false), allowRemoteRequests: z.boolean().default(false),
  sameVoiceUsersCan: z.object({
    addTracks: z.boolean().default(true), pauseResume: z.boolean().default(true), skip: z.boolean().default(false),
    removeOwnTracks: z.boolean().default(true), removeAnyTracks: z.boolean().default(false),
    reorderOwnTracks: z.boolean().default(true), reorderQueue: z.boolean().default(false),
    changeVolume: z.boolean().default(false), stopSession: z.boolean().default(false),
  }).prefault({}),
  defaultVolume: z.number().int().min(0).max(100).default(60), maxVolume: z.number().int().min(1).max(100).default(100),
  maxQueueItems: z.number().int().min(1).max(100).default(100), maxTracksPerUser: z.number().int().min(1).max(100).default(10),
  maxTrackDurationSeconds: z.number().int().min(30).max(10800).default(1800),
  duplicatePolicy: z.enum(['allow', 'reject', 'move_existing']).default('allow'),
  skipMode: z.enum(['direct', 'vote', 'djOnly']).default('vote'), skipVoteRatio: z.number().min(0.1).max(1).default(0.5),
  queueMode: z.enum(['normal', 'fair']).default('normal'), allowLiveStreams: z.boolean().default(false),
  emptyVoiceBehavior: z.enum(['pause_then_leave', 'stop_then_leave']).default('pause_then_leave'),
  emptyVoiceGraceSeconds: z.number().int().min(5).max(3600).default(120), resumeOnRejoin: z.boolean().default(false),
  djRoleIds: z.array(snowflake).max(30).default([]), allowedVoiceChannelIds: z.array(snowflake).max(100).default([]),
  blockedVoiceChannelIds: z.array(snowflake).max(100).default([]), allowedCategoryIds: z.array(snowflake).max(100).default([]),
  historyRetentionDays: z.number().int().min(1).max(90).default(30), explicitPolicy: z.enum(['allow', 'warn', 'block']).default('warn'),
  schemaVersion: z.literal(1).default(1),
}).refine((v) => v.defaultVolume <= v.maxVolume, 'Default volume exceeds maximum');
export type MediaSettings = z.infer<typeof mediaSettingsSchema>;
export const mediaTrackSchema = z.object({
  provider: z.enum(['direct', 'radio', 'spotify', 'youtube', 'soundcloud']), providerItemId: z.string().min(1).max(2048),
  type: z.enum(['track', 'live']), title: z.string().min(1).max(300), artist: z.string().max(200),
  durationMs: z.number().int().positive().nullable(), artworkUrl: httpUrl.nullable(), externalUrl: httpUrl,
  playable: z.boolean(), seekable: z.boolean(), explicit: z.boolean().nullable(),
});
export const mediaQueueItemSchema = mediaTrackSchema.extend({ queueItemId: z.uuid(), requestedByUserId: snowflake, requestedByName: z.string().max(100), requestedAt: z.number().int().nonnegative() });
export const mediaHistoryItemSchema = z.object({
  id: z.uuid(), track: mediaQueueItemSchema, playedAt: z.number().int().nonnegative(), endedAt: z.number().int().nonnegative(),
  result: z.enum(['finished', 'skipped', 'failed']), reason: z.string().max(400).nullable(),
});
export const mediaHistoryPageSchema = z.object({
  items: z.array(mediaHistoryItemSchema).max(50),
  next: z.object({ endedAt: z.number().int().nonnegative(), id: z.uuid() }).nullable(),
});
export type MediaHistoryPage = z.infer<typeof mediaHistoryPageSchema>;
export const mediaHistoryDeleteSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DELETE_ITEM'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('CLEAR_OWN') }).strict(),
]);
export type MediaHistoryDelete = z.infer<typeof mediaHistoryDeleteSchema>;
export const mediaHistoryDeleteResultSchema = z.object({ deleted: z.number().int().min(0).max(100), more: z.boolean() });
export const mediaSearchResultSchema = z.object({
  results: z.array(mediaTrackSchema).max(40), unavailable: z.array(z.string().max(100)).max(10),
  errors: z.array(z.string().max(400)).max(10).default([]),
  nextPage: z.number().int().min(1).max(9).nullable().default(null),
});
export const mediaSessionSchema = z.object({
  sessionId: z.uuid(), guildId: snowflake, voiceChannelId: snowflake, voiceChannelName: z.string().max(100),
  state: z.enum(['idle', 'connecting', 'buffering', 'playing', 'paused', 'reconnecting', 'stopping', 'error']),
  currentTrack: mediaQueueItemSchema.nullable(), queue: z.array(mediaQueueItemSchema).max(100),
  played: z.array(mediaQueueItemSchema).max(100).default([]),
  startedAt: z.number().nullable(), pausedAt: z.number().nullable(), accumulatedPauseMs: z.number().nonnegative(),
  playbackOffsetMs: z.number().int().min(0).max(10800000).optional(),
  volume: z.number().min(0).max(100), repeatMode: z.enum(['off', 'track', 'queue']), queueMode: z.enum(['normal', 'fair']),
  shuffle: z.boolean(), lockedMode: z.enum(['unlocked', 'dj', 'admin']), createdByUserId: snowflake,
  queueVersion: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  createdAt: z.number(), updatedAt: z.number(), recoverable: z.boolean(), lastError: z.string().max(400).nullable(), lastRequesterId: snowflake.nullable(),
});
const queueReference = { queueItemId: z.uuid(), expectedQueueVersion: z.number().int().nonnegative() };
const sourceReference = { provider: z.enum(['direct', 'radio', 'spotify', 'youtube', 'soundcloud']), providerItemId: z.string().min(1).max(2048) };
export const mediaActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD_TRACK'), ...sourceReference }).strict(),
  z.object({ type: z.literal('PLAY_TRACK'), ...sourceReference, following: z.array(z.object(sourceReference).strict()).max(99).optional() }).strict(),
  z.object({ type: z.literal('SEEK'), queueItemId: z.uuid(), positionMs: z.number().int().min(0).max(10800000) }).strict(),
  ...(['PAUSE', 'RESUME', 'SKIP', 'VOTE_SKIP', 'STOP', 'RESTORE', 'MOVE_SESSION'] as const).map((type) => z.object({ type: z.literal(type) }).strict()),
  z.object({ type: z.literal('REMOVE_QUEUE_ITEM'), ...queueReference }).strict(),
  z.object({ type: z.literal('MOVE_QUEUE_ITEM'), ...queueReference, position: z.number().int().min(0).max(99) }).strict(),
  z.object({ type: z.literal('SET_VOLUME'), volume: z.number().int().min(0).max(100) }).strict(),
  z.object({ type: z.literal('SET_REPEAT'), repeatMode: z.enum(['off', 'track', 'queue']) }).strict(),
  z.object({ type: z.literal('SET_SHUFFLE'), shuffle: z.boolean() }).strict(),
  z.object({ type: z.literal('SET_LOCK'), lockedMode: z.enum(['unlocked', 'dj', 'admin']) }).strict(),
]);
export type MediaAction = z.infer<typeof mediaActionSchema>;
export const mediaRequestSchema = z.object({ commandId: z.uuid(), sessionId: z.uuid().nullable(), expectedQueueVersion: z.number().int().nonnegative().nullable(), action: mediaActionSchema }).strict();
export const mediaCommandSchema = mediaRequestSchema.extend({ guildId: snowflake, actorUserId: snowflake }).strict();
export type MediaCommand = z.infer<typeof mediaCommandSchema>;
export const mediaInternalRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('state'), guildId: snowflake, actorUserId: snowflake }).strict(),
  z.object({ operation: z.literal('search'), guildId: snowflake, actorUserId: snowflake, query: z.string().trim().min(2).max(250), page: z.number().int().min(0).max(9).optional() }).strict(),
  z.object({ operation: z.literal('command'), command: mediaCommandSchema }).strict(),
  z.object({ operation: z.literal('settings'), guildId: snowflake, actorUserId: snowflake, settings: mediaSettingsSchema }).strict(),
]);
export type MediaInternalRequest = z.infer<typeof mediaInternalRequestSchema>;
export const mediaSnapshotSchema = z.object({
  session: mediaSessionSchema.nullable(), settings: mediaSettingsSchema,
  controls: z.record(z.string(), z.boolean()), queueControls: z.record(z.string(), z.object({ remove: z.boolean(), move: z.boolean() })),
  actorVoice: z.object({ id: snowflake.nullable(), name: z.string().nullable() }), remoteControl: z.boolean(), listenerCount: z.number().int().nonnegative(),
  votes: z.object({ count: z.number().int().nonnegative(), required: z.number().int().positive() }),
  providers: z.array(z.object({ id: z.enum(['direct', 'radio', 'spotify', 'youtube', 'soundcloud']), name: z.string(), state: z.enum(['available', 'degraded', 'unconfigured', 'error']), capabilities: z.object({ search: z.boolean(), metadata: z.boolean(), playback: z.boolean(), live: z.boolean(), seek: z.boolean(), playlists: z.boolean() }) })),
  engine: z.object({ available: z.boolean(), ffmpeg: z.boolean(), opus: z.boolean(), dave: z.boolean() }), serverTimestamp: z.number(), canManage: z.boolean(),
});
export type MediaSnapshot = z.infer<typeof mediaSnapshotSchema>;
export const mediaCommandResultSchema = z.object({ replayed: z.boolean(), snapshot: mediaSnapshotSchema, warning: z.string().max(400).optional() });
