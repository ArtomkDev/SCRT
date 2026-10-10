export type MediaProviderId = 'direct' | 'radio' | 'spotify' | 'youtube' | 'soundcloud';
export type MediaTrack = {
  provider: MediaProviderId; providerItemId: string; type: 'track' | 'live';
  title: string; artist: string; durationMs: number | null; artworkUrl: string | null;
  externalUrl: string; playable: boolean; seekable: boolean; explicit: boolean | null;
};
export type MediaQueueItem = MediaTrack & {
  queueItemId: string; requestedByUserId: string; requestedByName: string; requestedAt: number;
};
export type MediaState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'paused' | 'reconnecting' | 'stopping' | 'error';
export type MediaSession = {
  sessionId: string; guildId: string; voiceChannelId: string; voiceChannelName: string;
  state: MediaState; currentTrack: MediaQueueItem | null; queue: MediaQueueItem[]; played: MediaQueueItem[];
  startedAt: number | null; pausedAt: number | null; accumulatedPauseMs: number;
  playbackOffsetMs?: number;
  volume: number; repeatMode: 'off' | 'track' | 'queue'; queueMode: 'normal' | 'fair';
  shuffle: boolean; lockedMode: 'unlocked' | 'dj' | 'admin'; createdByUserId: string;
  queueVersion: number; revision: number; createdAt: number; updatedAt: number;
  recoverable: boolean; lastError: string | null; lastRequesterId: string | null;
};
export type MediaHistoryItem = { id: string; track: MediaQueueItem; playedAt: number; endedAt: number; result: 'finished' | 'skipped' | 'failed'; reason: string | null };
export type MediaProviderHealth = {
  id: MediaProviderId; name: string; state: 'available' | 'degraded' | 'unconfigured' | 'error';
  capabilities: { search: boolean; metadata: boolean; playback: boolean; live: boolean; seek: boolean; playlists: boolean };
};
export function mediaProgress(session: Pick<MediaSession, 'startedAt' | 'pausedAt' | 'accumulatedPauseMs' | 'playbackOffsetMs'> & { currentTrack: Pick<MediaTrack, 'durationMs'> | null }, now: number): number {
  if (session.startedAt === null) return 0;
  return Math.min(session.currentTrack?.durationMs ?? Infinity, Math.max(0, (session.playbackOffsetMs ?? 0) + (session.pausedAt ?? now) - session.startedAt - session.accumulatedPauseMs));
}
