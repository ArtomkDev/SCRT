import { z } from 'zod';
export * from './activity';
export * from './activity-artwork';
export * from './media';
export { renderVoiceRoomName, voiceNameVariables, type VoiceNameInput } from './voice-name';

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Expected a Discord snowflake');
export const guildIdSchema = snowflakeSchema;
export const discordUserSchema = z.object({ id: snowflakeSchema, username: z.string(), global_name: z.string().nullable().optional(), avatar: z.string().nullable().optional() });
export const discordGuildSchema = z.object({ id: guildIdSchema, name: z.string(), icon: z.string().nullable(), owner: z.boolean(), permissions: z.string() });
export const directoryMemberSchema = z.object({
  id: snowflakeSchema,
  username: z.string(),
  globalName: z.string().nullable(),
  nick: z.string().nullable(),
  avatarUrl: z.url(),
  roleIds: z.array(snowflakeSchema),
});
export type DirectoryMember = z.infer<typeof directoryMemberSchema>;
export const directoryChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('upsert'), member: directoryMemberSchema, previousRoleIds: z.array(snowflakeSchema).optional() }),
  z.object({ kind: z.literal('remove'), memberId: snowflakeSchema, roleIds: z.array(snowflakeSchema).optional() }),
]);
export type DirectoryChange = z.infer<typeof directoryChangeSchema>;
export const directoryEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sync'), revision: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('advance'), revision: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('reset'), revision: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('change'), revision: z.number().int().nonnegative(), change: directoryChangeSchema }),
]);
export type DirectoryEvent = z.infer<typeof directoryEventSchema>;
export const defaultCreatorChannelName = '➕ Створити кімнату';

export const voiceFeatureSchema = z.object({
  rename: z.boolean(), userLimit: z.boolean(), bitrate: z.boolean(), region: z.boolean(),
  lock: z.boolean(), hide: z.boolean(), permit: z.boolean(), block: z.boolean(),
  kick: z.boolean(), transfer: z.boolean(), claim: z.boolean(), reset: z.boolean(),
  delete: z.boolean(), chat: z.boolean(),
});
export const voiceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  cleanupDelaySeconds: z.number().int().min(0).max(3600).default(30),
  ownerLeaveGraceSeconds: z.number().int().min(0).max(3600).default(60),
  ownerExitBehavior: z.enum(['claimable', 'auto_transfer', 'keep_owner']).default('claimable'),
  duplicateRoomPolicy: z.enum(['reuse', 'allow']).default('reuse'),
  maxRoomsPerUser: z.number().int().min(1).max(5).default(1),
  defaultInterfaceMode: z.enum(['global', 'room', 'both', 'none']).default('room'),
  logChannelId: snowflakeSchema.nullable().default(null),
  bypassRoleIds: z.array(snowflakeSchema).max(30).default([]),
  schemaVersion: z.literal(1).default(1),
});
export const voiceCreatorSchema = z.object({
  id: snowflakeSchema, guildId: guildIdSchema, channelId: snowflakeSchema,
  targetCategoryId: snowflakeSchema.nullable().default(null),
  roomPlacement: z.enum(['above', 'below', 'top', 'bottom']).default('bottom'),
  roomOrder: z.enum(['oldest_first', 'newest_first']).default('oldest_first'),
  enabled: z.boolean().default(true), archived: z.boolean().default(false), nameTemplate: z.string().trim().min(1).max(100).default('🎧 {displayName}'),
  defaultUserLimit: z.number().int().min(0).max(99).default(0),
  defaultBitrate: z.number().int().min(8000).nullable().default(null),
  defaultRtcRegion: z.string().min(1).max(64).nullable().default(null),
  defaultLocked: z.boolean().default(false), defaultHidden: z.boolean().default(false), defaultChatClosed: z.boolean().default(false),
  allowedRoleIds: z.array(snowflakeSchema).max(30).default([]), bypassRoleIds: z.array(snowflakeSchema).max(30).default([]),
  interfaceMode: z.enum(['inherit', 'global', 'room', 'both', 'none']).default('inherit'),
  enabledFeatures: voiceFeatureSchema.default({ rename: true, userLimit: true, bitrate: true, region: true, lock: true, hide: true, permit: true, block: true, kick: true, transfer: true, claim: true, reset: true, delete: true, chat: true }),
  position: z.number().int().min(0).default(0), schemaVersion: z.literal(1).default(1),
});
export const voiceRoomSchema = z.object({
  channelId: snowflakeSchema, guildId: guildIdSchema, creatorId: snowflakeSchema,
  ownerId: snowflakeSchema.nullable(), state: z.enum(['creating', 'active', 'deleting', 'orphaned']),
  locked: z.boolean(), hidden: z.boolean(), chatClosed: z.boolean(),
  permittedUserIds: z.array(snowflakeSchema), blockedUserIds: z.array(snowflakeSchema),
  memberCount: z.number().int().min(0), ownerLeftAt: z.number().int().nullable(),
  nameCounter: z.number().int().min(1).optional(),
  createdAt: z.number().int(), updatedAt: z.number().int(), lastActivityAt: z.number().int(),
  schemaVersion: z.literal(1),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;
export type VoiceCreator = z.infer<typeof voiceCreatorSchema>;
export type VoiceRoom = z.infer<typeof voiceRoomSchema>;
export const voiceInterfaceSchema = z.object({
  id: snowflakeSchema, guildId: guildIdSchema, channelId: snowflakeSchema,
  messageId: snowflakeSchema.nullable(), enabled: z.boolean(),
  creatorIds: z.array(snowflakeSchema).nullable(), schemaVersion: z.literal(1),
});
export type VoiceInterface = z.infer<typeof voiceInterfaceSchema>;
