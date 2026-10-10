// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MediaTrack } from '@scrt/shared';
import { PlayerProgress } from './player-progress';

const track: MediaTrack = { provider: 'youtube', providerItemId: 'TwumA6YhQp4', title: 'Track', artist: 'Artist', type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://youtu.be/TwumA6YhQp4', playable: true, seekable: true, explicit: null };
afterEach(cleanup);
it('previews dragging and submits one bounded seek when released', () => {
  const onSeek = vi.fn(); render(<PlayerProgress track={track} progress={10000} maxDurationMs={1800000} canSeek onSeek={onSeek} />);
  const slider = screen.getByRole('slider', { name: 'Перемотати трек' });
  fireEvent.change(slider, { target: { value: '30000' } }); fireEvent.change(slider, { target: { value: '60000' } });
  expect(onSeek).not.toHaveBeenCalled(); expect(slider.getAttribute('aria-valuetext')).toBe('1:00');
  fireEvent.pointerUp(slider); expect(onSeek).toHaveBeenCalledExactlyOnceWith(60000);
  fireEvent.pointerUp(slider); expect(onSeek).toHaveBeenCalledOnce();
  expect(slider.getAttribute('max')).toBe('179000');
});
it('supports keyboard seeking and discards cancelled gestures', () => {
  const onSeek = vi.fn(); render(<PlayerProgress track={track} progress={10000} maxDurationMs={1800000} canSeek onSeek={onSeek} />);
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: '11000' } }); fireEvent.keyUp(slider, { key: 'ArrowRight' });
  expect(onSeek).toHaveBeenCalledExactlyOnceWith(11000);
  fireEvent.change(slider, { target: { value: '90000' } }); fireEvent.pointerCancel(slider); fireEvent.pointerUp(slider);
  expect(onSeek).toHaveBeenCalledOnce();
});
it('keeps unsupported or unauthorized tracks read-only and clears drafts on track replacement', () => {
  const onSeek = vi.fn(); const { rerender } = render(<PlayerProgress key="first" track={track} progress={10000} maxDurationMs={1800000} canSeek onSeek={onSeek} />);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '60000' } });
  rerender(<PlayerProgress key="second" track={track} progress={20000} maxDurationMs={1800000} canSeek onSeek={onSeek} />);
  expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('20000'); fireEvent.pointerUp(screen.getByRole('slider')); expect(onSeek).not.toHaveBeenCalled();
  rerender(<PlayerProgress track={{ ...track, type: 'live', durationMs: null, seekable: false }} progress={10000} maxDurationMs={1800000} canSeek={false} onSeek={onSeek} />);
  expect(screen.queryByRole('slider')).toBeNull(); expect(screen.getByRole('progressbar')).toBeTruthy(); expect(screen.getByText('LIVE')).toBeTruthy();
});
