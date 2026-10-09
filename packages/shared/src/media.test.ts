import { expect, it } from 'vitest';
import { mediaProgress } from './media';
it('interpolates from authoritative timestamps, freezes pauses and clamps duration', () => {
  const value = { startedAt: 1000, pausedAt: null, accumulatedPauseMs: 2000, currentTrack: { durationMs: 10000 } };
  expect(mediaProgress(value, 8000)).toBe(5000); expect(mediaProgress({ ...value, pausedAt: 6000 }, 8000)).toBe(3000); expect(mediaProgress(value, 90000)).toBe(10000); expect(mediaProgress({ ...value, startedAt: null }, 90000)).toBe(0);
});
