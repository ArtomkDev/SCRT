'use client';
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { MediaIcon } from './media-icon';

export const neutralAccent = '#afb7c4';
export type ArtworkPalette = Readonly<{ primary: string; secondary: string; tertiary: string }>;
export const neutralPalette: ArtworkPalette = { primary: neutralAccent, secondary: neutralAccent, tertiary: neutralAccent };
export function artworkPaletteStyle(palette: ArtworkPalette): CSSProperties {
  return { '--media-accent': palette.primary, '--media-accent-secondary': palette.secondary, '--media-accent-tertiary': palette.tertiary } as CSSProperties;
}
const fadeMs = 1600;
interface Artwork { url: string | null; palette: ArtworkPalette; cors: boolean }
interface Layer extends Artwork { id: number; visible: boolean }
const artworkCache = new Map<string, Artwork>();
const inflight = new Map<string, Promise<Artwork>>();

// Keep distinct, substantial cover regions; ignore borders, letterboxing and isolated vivid pixels.
export function artworkPalette(pixels: ArrayLike<number>): ArtworkPalette {
  const buckets = new Map<string, { weight: number; count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!;
    const high = Math.max(r, g, b), low = Math.min(r, g, b);
    if (pixels[index + 3]! < 192 || high < 35 || low > 225 || high - low < 25) continue;
    const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
    const bucket = buckets.get(key) ?? { weight: 0, count: 0, r: 0, g: 0, b: 0 };
    bucket.weight += 1 + (high - low) / 255; bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()].sort((a, b) => b.weight - a.weight).map((bucket) => {
    const r = bucket.r / bucket.count / 255, g = bucket.g / bucket.count / 255, b = bucket.b / bucket.count / 255;
    const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
    const hue = (high === r ? (g - b) / delta + (g < b ? 6 : 0) : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
    const saturation = Math.min(.85, Math.max(.5, delta / (1 - Math.abs(high + low - 1))));
    return { hue, saturation, weight: bucket.weight };
  });
  const primary = colors[0];
  if (!primary) return neutralPalette;
  const selected = [primary];
  for (const candidate of colors.slice(1)) {
    if (candidate.weight < primary.weight * .12) continue;
    if (selected.every((color) => { const distance = Math.abs(color.hue - candidate.hue); return Math.min(distance, 360 - distance) >= 35; })) selected.push(candidate);
    if (selected.length === 3) break;
  }
  const format = (color: typeof primary, lightness: number) => `hsl(${Math.round(color.hue)} ${Math.round(color.saturation * 100)}% ${lightness}%)`;
  return { primary: format(primary, 70), secondary: format(selected[1] ?? primary, 65), tertiary: format(selected[2] ?? selected[1] ?? primary, 75) };
}

function imageLoad(url: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    const timeout = setTimeout(() => finish(false), 8000);
    function finish(ok: boolean) {
      clearTimeout(timeout); image.onload = null; image.onerror = null;
      if (ok) resolve(image); else reject(new Error('Artwork unavailable'));
    }
    image.onload = () => { void (image.decode?.() ?? Promise.resolve()).catch(() => undefined).then(() => finish(true)); };
    image.onerror = () => finish(false);
    image.src = url;
  });
}
async function loadArtwork(url: string | null): Promise<Artwork> {
  if (!url) return { url: null, palette: neutralPalette, cors: false };
  const cached = artworkCache.get(url); if (cached) return cached;
  const pending = inflight.get(url); if (pending) return pending;
  const task = (async () => {
    let image: HTMLImageElement, cors = true;
    // YouTube's JPEG variant permits canvas access; the equivalent WebP often does not.
    const parsed = new URL(url);
    const corsUrl = parsed.hostname === 'i.ytimg.com' && /^\/vi_webp\/[\w-]{11}\/[^/]+\.webp$/.test(parsed.pathname)
      ? `https://i.ytimg.com${parsed.pathname.replace('/vi_webp/', '/vi/').replace(/\.webp$/, '.jpg')}` : url;
    try { image = await imageLoad(corsUrl, true); }
    catch { cors = false; try { image = await imageLoad(url, false); } catch { return { url: null, palette: neutralPalette, cors: false }; } }
    let palette = neutralPalette;
    if (cors) {
      try {
        const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) { context.drawImage(image, 0, 0, 48, 48); palette = artworkPalette(context.getImageData(0, 0, 48, 48).data); }
      } catch { /* A host without canvas access still gets a fully loaded cover. */ }
    }
    const value = { url: cors ? corsUrl : url, palette, cors };
    if (artworkCache.size >= 64) artworkCache.delete(artworkCache.keys().next().value!);
    artworkCache.set(url, value); return value;
  })();
  inflight.set(url, task);
  try { return await task; } finally { inflight.delete(url); }
}
export const MediaCover = memo(function MediaCover({ url, onPalette }: { url: string | null; onPalette: (palette: ArtworkPalette) => void }) {
  // Browser caches must only affect effects, never the initial hydrated markup.
  const [layers, setLayers] = useState<Layer[]>([{ url: null, palette: neutralPalette, cors: false, id: 0, visible: true }]);
  const sequence = useRef(0);
  const onColors = useRef(onPalette); onColors.current = onPalette;
  useEffect(() => {
    let cancelled = false, firstFrame = 0, secondFrame = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    void loadArtwork(url).then((artwork) => {
      if (cancelled) return;
      const id = ++sequence.current;
      setLayers((previous) => [...previous, { ...artwork, id, visible: false }]);
      // Two paints guarantee that the new, decoded image starts at zero opacity.
      firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
        if (cancelled) return;
        setLayers((previous) => previous.map((layer) => layer.id === id ? { ...layer, visible: true } : layer));
        onColors.current(artwork.palette);
        timers.add(setTimeout(() => setLayers((previous) => previous.filter((layer) => layer.id >= id)), fadeMs + 80));
      }); });
    });
    return () => { cancelled = true; cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); timers.forEach(clearTimeout); };
  }, [url]);
  return <span className="media-artwork media-artwork-large media-cover-stack" aria-hidden="true">{layers.map((layer) => <span key={layer.id} className={`media-cover-layer${layer.visible ? ' is-visible' : ''}`} onTransitionEnd={(event) => {
    if (event.target === event.currentTarget && event.propertyName === 'opacity' && layer.visible) setLayers((previous) => previous.filter((item) => item.id >= layer.id));
  }}>{layer.url ? <img src={layer.url} alt="" width="220" height="220" crossOrigin={layer.cors ? 'anonymous' : undefined} referrerPolicy="no-referrer" /> : <MediaIcon name="music" width="64" height="64" />}</span>)}</span>;
});
