'use server';
import { revalidatePath } from 'next/cache';
import { mediaSettingsSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { media } from '@/lib/server';
import { mediaInternal, MediaTransportError } from '@/lib/media-data';
import { voiceResources } from '@/lib/voice-data';
import type { ActionFormResult } from '@/app/components/action-form';

export async function saveMediaSettings(guildId: string, form: FormData): Promise<ActionFormResult> {
  const access = await requireGuildAccess(guildId, 'media.manage'); const previous = await media().getSettings(guildId);
  const boolean = (key: string) => form.get(key) === 'on'; const text = (key: string) => String(form.get(key) ?? ''); const number = (key: string) => Number(text(key));
  const policies = Object.fromEntries(Object.keys(previous.sameVoiceUsersCan).map((key) => [key, boolean(`policy.${key}`)]));
  const parsed = mediaSettingsSchema.safeParse({ ...previous, enabled: boolean('enabled'), controlMode: text('controlMode'), allowRemoteAdminControl: boolean('allowRemoteAdminControl'), allowRemoteRequests: boolean('allowRemoteRequests'), sameVoiceUsersCan: policies,
    defaultVolume: number('defaultVolume'), maxVolume: number('maxVolume'), maxQueueItems: number('maxQueueItems'), maxTracksPerUser: number('maxTracksPerUser'), maxTrackDurationSeconds: number('maxTrackDurationSeconds'),
    duplicatePolicy: text('duplicatePolicy'), skipMode: text('skipMode'), skipVoteRatio: number('skipVoteRatio'), queueMode: text('queueMode'), allowLiveStreams: boolean('allowLiveStreams'),
    emptyVoiceBehavior: text('emptyVoiceBehavior'), emptyVoiceGraceSeconds: number('emptyVoiceGraceSeconds'), resumeOnRejoin: boolean('resumeOnRejoin'), historyRetentionDays: number('historyRetentionDays'), explicitPolicy: text('explicitPolicy'),
    djRoleIds: form.getAll('djRoleIds').map(String), allowedVoiceChannelIds: form.getAll('allowedVoiceChannelIds').map(String), blockedVoiceChannelIds: form.getAll('blockedVoiceChannelIds').map(String), allowedCategoryIds: form.getAll('allowedCategoryIds').map(String) });
  if (!parsed.success) return { error: 'Некоректні налаштування Медіа. Перевірте значення полів; гучність нової сесії не може перевищувати максимальну.' };
  const value = parsed.data;
  const resources = await voiceResources(guildId, access.guild.resourceRevision);
  if (value.djRoleIds.some((id) => id === guildId || !resources.roles.some((role) => role.id === id)) || [...value.allowedVoiceChannelIds, ...value.blockedVoiceChannelIds].some((id) => !resources.channels.some((channel) => channel.id === id && channel.type === 2)) || value.allowedCategoryIds.some((id) => !resources.channels.some((channel) => channel.id === id && channel.type === 4))) return { error: 'Виберіть чинні ресурси цього сервера.' };
  try {
    await mediaInternal({ operation: 'settings', guildId, actorUserId: access.user.id, settings: value });
  } catch (error) {
    if (error instanceof MediaTransportError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/servers/${guildId}`, 'layout');
}
