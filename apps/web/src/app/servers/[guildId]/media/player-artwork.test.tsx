// @vitest-environment jsdom
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artworkPalette, MediaCover, neutralPalette } from './player-artwork';

interface PendingImage { src: string; onload: (() => void) | null; onerror: (() => void) | null; decode: () => Promise<void> }
let images: PendingImage[];
beforeEach(() => {
  vi.stubGlobal('React', React); vi.useFakeTimers(); images = [];
  vi.stubGlobal('Image', class { src = ''; onload = null; onerror = null; decode = () => Promise.resolve(); constructor() { images.push(this); } });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: [210, 20, 30, 255] }) } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const load = async (url: string) => { await act(async () => { images.find((image) => image.src === url)!.onload!(); }); await act(() => vi.advanceTimersByTimeAsync(32)); };

describe('artwork palette and uninterrupted crossfade', () => {
  it('renders the same initial markup with cold and warm browser artwork caches', async () => {
    const url = 'https://art.example/hydration.jpg'; const accent = vi.fn();
    const cold = renderToString(<MediaCover url={url} onPalette={accent} />);
    const view = render(<MediaCover url={url} onPalette={accent} />); await load(url); view.unmount();
    expect(accent).toHaveBeenCalledWith(expect.objectContaining({ primary: expect.stringMatching(/^hsl\(/) }));
    expect(renderToString(<MediaCover url={url} onPalette={accent} />)).toBe(cold);
  });
  it('loads the equivalent YouTube JPEG to read its palette when WebP forbids canvas access', async () => {
    const accent = vi.fn(); const view = render(<MediaCover url="https://i.ytimg.com/vi_webp/3pvSGwHgvhU/maxresdefault.webp" onPalette={accent} />);
    expect(images[0]!.src).toBe('https://i.ytimg.com/vi/3pvSGwHgvhU/maxresdefault.jpg');
    await load(images[0]!.src); await act(() => vi.advanceTimersByTimeAsync(1680));
    expect(accent).toHaveBeenCalledWith(expect.objectContaining({ primary: expect.stringMatching(/^hsl\(/) }));
    expect(view.container.querySelector('img')?.getAttribute('crossorigin')).toBe('anonymous');
  });
  it('uses the dominant cover hue, excludes transparent pixels and stays neutral for grayscale artwork', () => {
    expect(artworkPalette([220, 10, 30, 255, 0, 220, 20, 0, 0, 0, 0, 255, 255, 255, 255, 255]).primary).toMatch(/^hsl\((35[0-9]|0) /);
    expect(artworkPalette([15, 30, 200, 255]).primary).toMatch(/^hsl\(23[0-9] /);
    expect(artworkPalette([110, 110, 110, 255, 255, 255, 255, 255])).toEqual(neutralPalette);
    const dominant = Array.from({ length: 20 }, () => [20, 180, 100, 255]).flat();
    expect(artworkPalette([...dominant, 250, 0, 0, 255]).primary).toMatch(/^hsl\(150 /);
  });
  it('chooses separate cover hues instead of neighboring shades or isolated color noise', () => {
    const region = (rgb: number[], count: number) => Array.from({ length: count }, () => [...rgb, 255]).flat();
    const palette = artworkPalette([...region([210, 20, 30], 40), ...region([240, 30, 40], 30), ...region([20, 180, 100], 18), ...region([20, 40, 220], 12), ...region([255, 230, 0], 1)]);
    expect(palette.primary).toMatch(/^hsl\(35[0-9] /);
    expect(palette.secondary).toMatch(/^hsl\(150 /);
    expect(palette.tertiary).toMatch(/^hsl\(234 /);
    expect(artworkPalette([100, 100, 100, 255, 0, 220, 0, 0])).toEqual(neutralPalette);
    const monochrome = artworkPalette(region([20, 180, 100], 20));
    expect(Object.values(monochrome).every((color) => color.startsWith('hsl(150 '))).toBe(true);
  });
  it('publishes the full palette only after the new cover has decoded and become visible', async () => {
    const palette = vi.fn(); const view = render(<MediaCover url="https://art.example/palette.jpg" onPalette={palette} />);
    expect(palette).not.toHaveBeenCalled();
    await load('https://art.example/palette.jpg');
    expect(palette).toHaveBeenLastCalledWith(artworkPalette([210, 20, 30, 255]));
    expect(view.container.querySelector('img')?.closest('.media-cover-layer')?.classList.contains('is-visible')).toBe(true);
    view.rerender(<MediaCover url={null} onPalette={palette} />);
    await act(() => vi.advanceTimersByTimeAsync(32));
    expect(palette).toHaveBeenLastCalledWith(neutralPalette);
  });
  it('keeps the previous image until the next one decodes, then overlays it before removing the old layer', async () => {
    const accent = vi.fn(); const view = render(<MediaCover url="https://art.example/first.jpg" onPalette={accent} />);
    await load('https://art.example/first.jpg'); await act(() => vi.advanceTimersByTimeAsync(1680));
    view.rerender(<MediaCover url="https://art.example/second.jpg" onPalette={accent} />);
    expect(view.container.querySelector('img')?.src).toBe('https://art.example/first.jpg');
    let decoded!: () => void; images.at(-1)!.decode = () => new Promise<void>((done) => { decoded = done; });
    await act(async () => { images.at(-1)!.onload!(); });
    expect(view.container.querySelectorAll('img')).toHaveLength(1);
    await act(async () => { decoded(); });
    expect(view.container.querySelectorAll('img')).toHaveLength(2);
    expect(view.container.querySelectorAll('.is-visible')).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(32)); expect(view.container.querySelectorAll('.is-visible')).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1000)); expect(view.container.querySelectorAll('img')).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(680)); expect(view.container.querySelectorAll('img')).toHaveLength(1);
    expect(view.container.querySelector('img')?.src).toBe('https://art.example/second.jpg');
  });
  it('ignores late covers from superseded tracks and never drops visible layers during rapid changes', async () => {
    const accent = vi.fn(); const view = render(<MediaCover url="https://art.example/A.jpg" onPalette={accent} />);
    await load('https://art.example/A.jpg'); await act(() => vi.advanceTimersByTimeAsync(1680));
    view.rerender(<MediaCover url="https://art.example/B.jpg" onPalette={accent} />); await load('https://art.example/B.jpg');
    view.rerender(<MediaCover url="https://art.example/C.jpg" onPalette={accent} />);
    view.rerender(<MediaCover url="https://art.example/D.jpg" onPalette={accent} />); await load('https://art.example/D.jpg');
    await load('https://art.example/C.jpg');
    expect([...view.container.querySelectorAll('img')].map((image) => image.src)).toEqual(['https://art.example/A.jpg', 'https://art.example/B.jpg', 'https://art.example/D.jpg']);
    await act(() => vi.advanceTimersByTimeAsync(1680));
    expect(view.container.querySelectorAll('img')).toHaveLength(1); expect(view.container.querySelector('img')?.src).toBe('https://art.example/D.jpg');
  });
});
