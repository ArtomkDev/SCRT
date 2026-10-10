// Read compatibility only. Removed providers must never reach playback/API schemas.
export function isRetiredMediaTrack(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'provider' in value && (value.provider === 'spotify' || value.provider === 'radio');
}
export function migrateMediaSession(value: Record<string, unknown>): Record<string, unknown> {
  const queue = Array.isArray(value.queue) ? value.queue.filter((track) => !isRetiredMediaTrack(track)) : value.queue;
  const played = Array.isArray(value.played) ? value.played.filter((track) => !isRetiredMediaTrack(track)) : value.played;
  return { ...value, queue, ...(played === undefined ? {} : { played }), ...(isRetiredMediaTrack(value.currentTrack) ? {
    currentTrack: null, state: 'idle', recoverable: Array.isArray(queue) && queue.length > 0,
    startedAt: null, pausedAt: null, accumulatedPauseMs: 0, playbackOffsetMs: 0,
    lastError: 'Попереднє джерело більше не підтримується. Виберіть YouTube, SoundCloud або аудіофайл.',
  } : {}) };
}
