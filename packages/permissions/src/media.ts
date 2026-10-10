// Structural policy inputs keep this package independent of apps and persistence.
export type MediaPolicySettings = {
  enabled: boolean; controlMode: 'OPEN' | 'QUEUE' | 'DJ'; allowRemoteAdminControl: boolean; allowRemoteRequests: boolean;
  skipMode: 'direct' | 'vote' | 'djOnly'; djRoleIds: readonly string[];
  sameVoiceUsersCan: Record<'addTracks' | 'pauseResume' | 'skip' | 'removeOwnTracks' | 'removeAnyTracks' | 'reorderOwnTracks' | 'reorderQueue' | 'changeVolume' | 'stopSession', boolean>;
};
export type MediaActor = { userId: string; permissions: ReadonlySet<string>; roleIds: readonly string[]; voiceChannelId: string | null };
export function mediaPolicy(settings: MediaPolicySettings, actor: MediaActor, session: { voiceChannelId: string; lockedMode: 'unlocked' | 'dj' | 'admin' } | null, action: string, ownerId?: string): string | null {
  if (!actor.permissions.has('media.view')) return 'Недостатньо прав для перегляду Медіа.';
  if (action === 'VIEW') return null;
  if (!settings.enabled) return 'Модуль Медіа вимкнено.';
  const manager = actor.permissions.has('media.manage');
  const dj = actor.permissions.has('media.control') || settings.djRoleIds.some((id) => actor.roleIds.includes(id));
  if (action === 'MOVE_SESSION') return manager && actor.voiceChannelId ? null : 'Переміщення потребує media.manage та входу в цільовий Voice.';
  if (!session && !actor.voiceChannelId) return 'Приєднайтеся до голосового каналу, щоб почати відтворення.';
  const sameVoice = actor.voiceChannelId !== null && (!session || session.voiceChannelId === actor.voiceChannelId);
  const remote = manager && settings.allowRemoteAdminControl;
  // Managers already have permission to move a session; restore can do both in their current Voice.
  const restoreInActorVoice = action === 'RESTORE' && manager && actor.voiceChannelId !== null;
  if (action === 'RESTORE' && !sameVoice && !restoreInActorVoice) return 'Приєднайтеся до початкового голосового каналу або попросіть адміністратора відновити чергу у вашому Voice.';
  if (!sameVoice && !remote && !restoreInActorVoice && !(action === 'ADD_TRACK' && settings.allowRemoteRequests)) return 'Приєднайтеся до голосового каналу SCRT, щоб керувати плеєром.';
  if (session?.lockedMode === 'admin' && !manager) return 'Керування доступне лише адміністратору Медіа.';
  if (action === 'ADD_TRACK' || action === 'PLAY_TRACK' && !session) return actor.permissions.has('media.request') && (manager || dj || settings.sameVoiceUsersCan.addTracks) ? null : 'Додавання треків недоступне.';
  if ((action === 'PLAY_TRACK' || action === 'SEEK') && !actor.permissions.has('media.request')) return 'Керування треками потребує media.request.';
  if (!manager && !dj && (session?.lockedMode === 'dj' || settings.controlMode === 'DJ')) return 'Керування доступне лише DJ.';
  if (action === 'VOTE_SKIP') return sameVoice && settings.skipMode === 'vote' && actor.permissions.has('media.request') ? null : 'Голосування недоступне.';
  if (manager) return null;
  if (action === 'SET_LOCK') return dj && session?.lockedMode !== 'admin' ? null : 'Зміна режиму потребує DJ.';
  if (dj) return null;
  const own = ownerId === actor.userId;
  const flags = settings.sameVoiceUsersCan;
  const allowed = (action === 'PAUSE' || action === 'RESUME' || action === 'RESTORE') ? flags.pauseResume
    : action === 'SKIP' || action === 'PLAY_TRACK' || action === 'SEEK' ? settings.skipMode === 'direct' && flags.skip
    : action === 'REMOVE_QUEUE_ITEM' ? flags.removeAnyTracks || (own && flags.removeOwnTracks)
    : action === 'MOVE_QUEUE_ITEM' ? flags.reorderQueue || (own && flags.reorderOwnTracks)
    : action === 'SET_VOLUME' ? flags.changeVolume
    : action === 'STOP' ? flags.stopSession
    : settings.controlMode === 'OPEN' && flags.reorderQueue;
  return allowed && actor.permissions.has('media.request') ? null : 'Ця дія потребує дозволу DJ або адміністратора Медіа.';
}
