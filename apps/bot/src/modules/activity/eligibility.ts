import type { ActivitySettings } from '@scrt/validation';

export type ActivityActor = { userId: string; bot: boolean; roleIds: readonly string[] | null };
export type ActivityChannel = { id: string; parentId: string | null; categoryId: string | null; afk: boolean };
export type ActivityTracker = 'messages' | 'voice' | 'streaming' | 'games';
export function activityEligible(settings: ActivitySettings, tracker: ActivityTracker, actor: ActivityActor, channel: ActivityChannel | null): boolean {
  if (!settings.enabled || !settings.tracking[tracker] || actor.bot || settings.exclusions.userIds.includes(actor.userId)) return false;
  if (settings.exclusions.roleIds.length && (!actor.roleIds || actor.roleIds.some((id) => settings.exclusions.roleIds.includes(id)))) return false;
  if (!channel) return tracker === 'games';
  if (settings.exclusions.ignoreAfkChannel && channel.afk) return false;
  return ![channel.id, channel.parentId].some((id) => id !== null && settings.exclusions.channelIds.includes(id)) && ![channel.categoryId, channel.parentId].some((id) => id !== null && settings.exclusions.categoryIds.includes(id));
}
