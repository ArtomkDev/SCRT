'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { botCreateVoiceChannel, botCreateVoiceInterfaceMessage, botDeleteChannel, botDeleteVoiceInterfaceMessage, botGuildChannels, botGuildRoles, botRenameVoiceChannel, botVoiceRegions } from '@scrt/discord';
import { defaultCreatorChannelName, renderVoiceRoomName, snowflakeSchema, voiceCreatorSchema, voiceSettingsSchema, type VoiceCreator } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { env, voice } from '@/lib/server';

const one = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const selected = (form: FormData, key: string) => form.getAll(key).map(String);
const bool = (form: FormData, key: string) => form.get(key) === 'on';
const num = (form: FormData, key: string) => Number(one(form, key));
const refresh = (guildId: string, channelsChanged = false) => {
  if (channelsChanged) updateTag(`voice-channels:${guildId}`);
  revalidatePath(`/servers/${guildId}/voice`, 'layout');
};

async function audit(guildId: string, action: string, actorId: string, details: { channelId?: string; creatorId?: string } = {}) {
  try {
    await voice().audit({ guildId, action, actorId, source: 'dashboard', ...details });
  } catch (error) {
    // A completed mutation must not be reported as failed because its audit write failed.
    console.error('Voice audit write failed', { guildId, action, error });
  }
}

export async function saveVoiceSettings(guildId: string, form: FormData) {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  const logChannelId = one(form, 'logChannelId') || null;
  const bypassRoleIds = selected(form, 'bypassRoleIds');
  const token = env().DISCORD_BOT_TOKEN;
  const [channels, roles] = await Promise.all([
    logChannelId ? botGuildChannels(token, guildId) : Promise.resolve([]),
    bypassRoleIds.length ? botGuildRoles(token, guildId) : Promise.resolve([]),
  ]);
  if (logChannelId && !channels.some((channel) => channel.id === logChannelId && channel.type === 0)) throw new Error('Invalid log channel');
  if (bypassRoleIds.some((id) => !roles.some((role) => role.id === id))) throw new Error('Invalid bypass role');
  const value = voiceSettingsSchema.parse({ enabled: bool(form, 'enabled'), cleanupDelaySeconds: num(form, 'cleanupDelaySeconds'), ownerLeaveGraceSeconds: num(form, 'ownerLeaveGraceSeconds'), ownerExitBehavior: one(form, 'ownerExitBehavior'), duplicateRoomPolicy: one(form, 'duplicateRoomPolicy'), maxRoomsPerUser: num(form, 'maxRoomsPerUser'), defaultInterfaceMode: one(form, 'defaultInterfaceMode'), logChannelId, bypassRoleIds, schemaVersion: 1 });
  await voice().saveSettings(guildId, value);
  await audit(guildId, 'voice.settings_updated', user.id);
  revalidatePath(`/servers/${guildId}`, 'layout');
}

export async function enableVoice(guildId: string): Promise<void> {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  const settings = await voice().getSettings(guildId);
  await voice().saveSettings(guildId, { ...settings, enabled: true });
  await audit(guildId, 'voice.settings_updated', user.id);
  revalidatePath(`/servers/${guildId}`, 'layout');
}

export async function saveVoiceCreator(guildId: string, form: FormData) {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  const token = env().DISCORD_BOT_TOKEN;
  const [channels, roles] = await Promise.all([botGuildChannels(token, guildId), botGuildRoles(token, guildId)]);
  const targetCategoryId = one(form, 'targetCategoryId') || null;
  if (targetCategoryId && !channels.some((channel) => channel.id === targetCategoryId && channel.type === 4)) throw new Error('Invalid category');
  const allowedRoleIds = selected(form, 'allowedRoleIds');
  const bypassRoleIds = selected(form, 'bypassRoleIds');
  if ([...allowedRoleIds, ...bypassRoleIds].some((id) => !roles.some((role) => role.id === id))) throw new Error('Invalid role');
  const nameTemplate = one(form, 'nameTemplate');
  renderVoiceRoomName(nameTemplate, { username: 'Учасник', displayName: 'Учасник', counter: 1 });
  const defaultRtcRegion = one(form, 'defaultRtcRegion') || null;
  if (defaultRtcRegion && !(await botVoiceRegions(token)).some((region) => region.id === defaultRtcRegion)) throw new Error('Invalid voice region');
  let channelId = one(form, 'channelId');
  const created = channelId === 'new';
  if (created && bool(form, 'renameCreatorChannel')) throw new Error('Invalid Creator channel rename');
  const existingChannel = created ? undefined : channels.find((channel) => channel.id === channelId && channel.type === 2);
  const renameRequested = bool(form, 'renameCreatorChannel') && one(form, 'creatorChannelName') !== one(form, 'originalCreatorChannelName');
  const requestedName = one(form, 'creatorChannelName');
  if (renameRequested && (!requestedName || requestedName.length > 100)) throw new Error('Invalid creator channel name');
  if (created) {
    const name = requestedName || defaultCreatorChannelName;
    if (name.length > 100) throw new Error('Invalid creator channel name');
    const channel = await botCreateVoiceChannel(token, guildId, name, targetCategoryId);
    channelId = channel.id;
  } else {
    if (!existingChannel) throw new Error('Invalid creator channel');
    if (await voice().getRoom(guildId, channelId)) throw new Error('Тимчасову кімнату SCRT не можна призначити каналом створення.');
  }
  const features = ['rename', 'userLimit', 'bitrate', 'region', 'lock', 'hide', 'permit', 'block', 'kick', 'transfer', 'claim', 'reset', 'delete', 'chat'] as const;
  const enabledFeatures = Object.fromEntries(features.map((feature) => [feature, bool(form, `feature_${feature}`)]));
  let saved = false;
  let renamed = false;
  try {
    const prior = await voice().getCreator(guildId, channelId);
    const creator: VoiceCreator = voiceCreatorSchema.parse({ id: channelId, guildId, channelId, targetCategoryId, roomPlacement: one(form, 'roomPlacement') || prior?.roomPlacement || 'bottom', roomOrder: one(form, 'roomOrder') || prior?.roomOrder || 'oldest_first', enabled: bool(form, 'enabled'), archived: false, nameTemplate, defaultUserLimit: num(form, 'defaultUserLimit'), defaultBitrate: one(form, 'defaultBitrate') ? num(form, 'defaultBitrate') : null, defaultRtcRegion, defaultLocked: bool(form, 'defaultLocked'), defaultHidden: bool(form, 'defaultHidden'), defaultChatClosed: bool(form, 'defaultChatClosed'), allowedRoleIds, bypassRoleIds, interfaceMode: one(form, 'interfaceMode'), enabledFeatures, position: prior?.position ?? 0, schemaVersion: 1 });
    if (renameRequested) {
      if (!prior || !existingChannel?.name) throw new Error('Invalid Creator channel rename');
      if (requestedName !== existingChannel.name) {
        await botRenameVoiceChannel(token, channelId, requestedName);
        renamed = true;
      }
    }
    await voice().saveCreator(guildId, creator);
    saved = true;
    await audit(guildId, prior ? 'creator.updated' : 'creator.created', user.id, { creatorId: creator.id });
  } catch (error) {
    if (created && !saved) await botDeleteChannel(token, channelId);
    if (renamed && !saved && existingChannel?.name) {
      try { await botRenameVoiceChannel(token, channelId, existingChannel.name); }
      catch (rollbackError) { console.error('Creator channel name rollback failed', { guildId, channelId, rollbackError }); }
      updateTag(`voice-channels:${guildId}`);
    }
    throw error;
  }
  refresh(guildId, created || renamed);
}

export async function deleteVoiceCreator(guildId: string, form: FormData) {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  const creatorId = snowflakeSchema.parse(one(form, 'creatorId'));
  const creator = await voice().getCreator(guildId, creatorId);
  if (!creator) return;
  const alsoDeleteChannel = bool(form, 'alsoDeleteChannel');
  if (alsoDeleteChannel) {
    if (one(form, 'confirmDelete') !== 'confirmed') throw new Error('Confirm Discord channel deletion');
    const channels = await botGuildChannels(env().DISCORD_BOT_TOKEN, guildId);
    if (!channels.some((channel) => channel.id === creator.channelId && channel.type === 2)) throw new Error('Creator channel missing');
    await botDeleteChannel(env().DISCORD_BOT_TOKEN, creator.channelId);
  }
  await voice().deleteCreator(guildId, creatorId);
  await audit(guildId, 'creator.deleted', user.id, { creatorId });
  refresh(guildId, alsoDeleteChannel);
}

export async function deleteVoiceRoom(guildId: string, form: FormData) {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  if (!bool(form, 'confirm')) throw new Error('Confirm room deletion');
  const channelId = snowflakeSchema.parse(one(form, 'channelId'));
  const room = await voice().getRoom(guildId, channelId);
  if (!room) return;
  await botDeleteChannel(env().DISCORD_BOT_TOKEN, channelId);
  await voice().deleteRoom(guildId, channelId);
  await audit(guildId, 'room.deleted', user.id, { channelId, creatorId: room.creatorId });
  refresh(guildId, true);
}

export async function publishVoiceInterface(guildId: string, form: FormData) {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  const channelId = snowflakeSchema.parse(one(form, 'channelId'));
  const token = env().DISCORD_BOT_TOKEN;
  const channels = await botGuildChannels(token, guildId);
  if (!channels.some((channel) => channel.id === channelId && channel.type === 0)) throw new Error('Invalid interface channel');
  const creatorIds = selected(form, 'creatorIds');
  const creators = await voice().listCreators(guildId);
  if (creatorIds.some((id) => !creators.some((creator) => creator.id === id))) throw new Error('Invalid creator');
  const previous = (await voice().listInterfaces(guildId)).find((item) => item.id === channelId);
  const message = await botCreateVoiceInterfaceMessage(token, channelId);
  try {
    await voice().saveInterface({ id: channelId, guildId, channelId, messageId: message.id, creatorIds: creatorIds.length ? creatorIds : null, enabled: true, schemaVersion: 1 });
  } catch (error) { await botDeleteVoiceInterfaceMessage(token, channelId, message.id); throw error; }
  if (previous?.messageId) {
    try {
      await botDeleteVoiceInterfaceMessage(token, channelId, previous.messageId);
    } catch (error) {
      console.error('Previous voice interface message cleanup failed', { guildId, channelId, error });
    }
  }
  await audit(guildId, previous ? 'interface.repaired' : 'interface.created', user.id, { channelId });
  refresh(guildId);
}

export async function deleteVoiceInterface(guildId: string, form: FormData) {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  const channelId = snowflakeSchema.parse(one(form, 'channelId'));
  const item = (await voice().listInterfaces(guildId)).find((value) => value.id === channelId);
  if (!item) return;
  if (item.messageId) await botDeleteVoiceInterfaceMessage(env().DISCORD_BOT_TOKEN, item.channelId, item.messageId);
  await voice().deleteInterface(guildId, item.id);
  await audit(guildId, 'interface.deleted', user.id, { channelId });
  refresh(guildId);
}

export async function setVoiceInterfaceEnabled(guildId: string, form: FormData) {
  const { user } = await requireGuildAccess(guildId, 'voice.manage');
  const channelId = snowflakeSchema.parse(one(form, 'channelId'));
  const item = (await voice().listInterfaces(guildId)).find((value) => value.id === channelId);
  if (!item) throw new Error('Interface missing');
  await voice().saveInterface({ ...item, enabled: bool(form, 'enabled') });
  await audit(guildId, bool(form, 'enabled') ? 'interface.enabled' : 'interface.disabled', user.id, { channelId });
  refresh(guildId);
}
