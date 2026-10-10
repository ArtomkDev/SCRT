// @vitest-environment jsdom
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artworkAccent, MediaCover, neutralAccent } from './player-artwork';

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
    const cold = renderToString(<MediaCover url={url} onAccent={accent} />);
    const view = render(<MediaCover url={url} onAccent={accent} />); await load(url); view.unmount();
    expect(accent).toHaveBeenCalledWith(expect.stringMatching(/^hsl\(/));
    expect(renderToString(<MediaCover url={url} onAccent={accent} />)).toBe(cold);
  });
  it('loads the equivalent YouTube JPEG to read its palette when WebP forbids canvas access', async () => {
    const accent = vi.fn(); const view = render(<MediaCover url="https://i.ytimg.com/vi_webp/3pvSGwHgvhU/maxresdefault.webp" onAccent={accent} />);
    expect(images[0]!.src).toBe('https://i.ytimg.com/vi/3pvSGwHgvhU/maxresdefault.jpg');
    await load(images[0]!.src); await act(() => vi.advanceTimersByTimeAsync(1680));
    expect(accent).toHaveBeenCalledWith(expect.stringMatching(/^hsl\(/));
    expect(view.container.querySelector('img')?.getAttribute('crossorigin')).toBe('anonymous');
  });
  it('uses the dominant cover hue, excludes transparent pixels and stays neutral for grayscale artwork', () => {
    expect(artworkAccent([220, 10, 30, 255, 0, 220, 20, 0, 0, 0, 0, 255, 255, 255, 255, 255])).toMatch(/^hsl\((35[0-9]|0) /);
    expect(artworkAccent([15, 30, 200, 255])).toMatch(/^hsl\(23[0-9] /);
    expect(artworkAccent([110, 110, 110, 255, 255, 255, 255, 255])).toBe(neutralAccent);
    const dominant = Array.from({ length: 20 }, () => [20, 180, 100, 255]).flat();
    expect(artworkAccent([...dominant, 250, 0, 0, 255])).toMatch(/^hsl\(150 /);
  });
  it('keeps the previous image until the next one decodes, then overlays it before removing the old layer', async () => {
    const accent = vi.fn(); const view = render(<MediaCover url="https://art.example/first.jpg" onAccent={accent} />);
    await load('https://art.example/first.jpg'); await act(() => vi.advanceTimersByTimeAsync(1680));
    view.rerender(<MediaCover url="https://art.example/second.jpg" onAccent={accent} />);
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
    const accent = vi.fn(); const view = render(<MediaCover url="https://art.example/A.jpg" onAccent={accent} />);
    await load('https://art.example/A.jpg'); await act(() => vi.advanceTimersByTimeAsync(1680));
    view.rerender(<MediaCover url="https://art.example/B.jpg" onAccent={accent} />); await load('https://art.example/B.jpg');
    view.rerender(<MediaCover url="https://art.example/C.jpg" onAccent={accent} />);
    view.rerender(<MediaCover url="https://art.example/D.jpg" onAccent={accent} />); await load('https://art.example/D.jpg');
    await load('https://art.example/C.jpg');
    expect([...view.container.querySelectorAll('img')].map((image) => image.src)).toEqual(['https://art.example/A.jpg', 'https://art.example/B.jpg', 'https://art.example/D.jpg']);
    await act(() => vi.advanceTimersByTimeAsync(1680));
    expect(view.container.querySelectorAll('img')).toHaveLength(1); expect(view.container.querySelector('img')?.src).toBe('https://art.example/D.jpg');
  });
});
