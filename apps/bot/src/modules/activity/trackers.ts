import { ActivityType, type Activity, type Presence, type VoiceState } from 'discord.js';
import { normalizeGame } from '@scrt/shared';
import type { ActivitySettings } from '@scrt/validation';
import { activityEligible, type ActivityActor, type ActivityChannel } from './eligibility';
import type { DesiredSession } from './session-service';

export function voiceSessions(state: Pick<VoiceState, 'channelId' | 'streaming'> | undefined, settings: ActivitySettings, actor: ActivityActor, channel: ActivityChannel | null): DesiredSession[] {
  if (!state?.channelId || !channel) return [];
  const sessions: DesiredSession[] = [];
  if (activityEligible(settings, 'voice', actor, channel)) sessions.push({ tracker: 'voice', channelId: state.channelId, game: null });
  if (state.streaming && activityEligible(settings, 'streaming', actor, channel)) sessions.push({ tracker: 'stream', channelId: state.channelId, game: null });
  return sessions;
}
export type GamePresence = { status: Presence['status']; activities: Array<Pick<Activity, 'type' | 'name' | 'applicationId'>> };
export function gameSessions(presence: GamePresence | undefined, settings: ActivitySettings, actor: ActivityActor, available: boolean): DesiredSession[] {
  if (!available || !presence || presence.status === 'offline' || !activityEligible(settings, 'games', actor, null)) return [];
  const games = new Map<string, DesiredSession>();
  for (const activity of presence.activities) {
    if (activity.type !== ActivityType.Playing) continue;
    const game = normalizeGame(activity.name, activity.applicationId);
    if (game && !settings.games.ignoredGameKeys.includes(game.gameKey)) games.set(game.gameKey, { tracker: 'game', channelId: null, game });
  }
  return [...games.values()];
}
