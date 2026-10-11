// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { neutralPalette } from '@/app/servers/[guildId]/media/player-artwork';
import { useMediaAmbience } from './media-player-ambience';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('changes the composition for a new track even with the same or missing artwork', () => {
  const { result, rerender } = renderHook(({ key }) => useMediaAmbience(key, neutralPalette), { initialProps: { key: 'guild:a' } });
  const first = result.current;
  rerender({ key: 'guild:b' });
  expect(result.current).not.toEqual(first);
  expect(result.current).toMatchObject({ '--media-accent': neutralPalette.primary });
  const second = result.current;
  rerender({ key: 'other-guild:b' });
  expect(result.current).not.toEqual(second);
});

it('keeps the composition through repeated snapshots, loading gaps and delayed palette updates', () => {
  const { result, rerender } = renderHook(({ key, palette }) => useMediaAmbience(key, palette), { initialProps: { key: null as string | null, palette: neutralPalette } });
  const empty = result.current;
  rerender({ key: 'a', palette: neutralPalette });
  expect(result.current).toEqual(empty);
  rerender({ key: 'b', palette: neutralPalette });
  const second = result.current;
  rerender({ key: null, palette: neutralPalette });
  expect(result.current).toEqual(second);
  const palette = { primary: '#bc7358', secondary: '#567483', tertiary: '#94856c' };
  rerender({ key: 'b', palette });
  expect(result.current).toEqual({ ...second, '--media-accent': palette.primary, '--media-accent-secondary': palette.secondary, '--media-accent-tertiary': palette.tertiary });
  const colored = result.current;
  rerender({ key: 'b', palette });
  expect(result.current).toBe(colored);
});

it('handles rapid skipping with bounded presets and no delayed work that can overwrite the last selection', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ key }) => useMediaAmbience(key, neutralPalette), { initialProps: { key: '0' } });
  const variants = new Set([JSON.stringify(result.current)]);
  for (let index = 1; index <= 101; index++) {
    const previous = result.current;
    rerender({ key: String(index) });
    expect(result.current).not.toEqual(previous);
    variants.add(JSON.stringify(result.current));
  }
  expect(variants.size).toBe(4);
  const last = result.current;
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(10000));
  rerender({ key: '101' });
  expect(result.current).toEqual(last);
});
