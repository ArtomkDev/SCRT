import { expect, it } from 'vitest';
import { mediaProgress } from './media';
it('interpolates from authoritative timestamps, freezes pauses and clamps duration', () => {
  const value = { startedAt: 1000, pausedAt: null, accumulatedPauseMs: 2000, currentTrack: { durationMs: 10000 } };
  expect(mediaProgress(value, 8000)).toBe(5000); expect(mediaProgress({ ...value, pausedAt: 6000 }, 8000)).toBe(3000); expect(mediaProgress(value, 90000)).toBe(10000); expect(mediaProgress({ ...value, startedAt: null }, 90000)).toBe(0);
});
it('adds the seek position to elapsed playback and keeps paused seeking frozen', () => {
  const value = { startedAt: 1000, pausedAt: null, accumulatedPauseMs: 2000, playbackOffsetMs: 40000, currentTrack: { durationMs: 60000 } };
  expect(mediaProgress(value, 8000)).toBe(45000);
  expect(mediaProgress({ ...value, pausedAt: 1000, accumulatedPauseMs: 0 }, 90000)).toBe(40000);
  expect(mediaProgress(value, 90000)).toBe(60000);
  expect(mediaProgress({ ...value, playbackOffsetMs: 5000 }, 8000)).toBe(10000);
});
