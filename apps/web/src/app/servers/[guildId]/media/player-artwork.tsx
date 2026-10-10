'use client';
import { useEffect, useRef, useState } from 'react';
import { MediaIcon } from './media-icon';

export const neutralAccent = '#afb7c4';
const fadeMs = 1600;
interface Artwork { url: string | null; accent: string; cors: boolean }
interface Layer extends Artwork { id: number; visible: boolean }
const artworkCache = new Map<string, Artwork>();
const inflight = new Map<string, Promise<Artwork>>();

// Prefer a dominant chromatic region over white borders, black letterboxing and isolated vivid pixels.
export function artworkAccent(pixels: ArrayLike<number>): string {
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
  const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!best) return neutralAccent;
  const r = best.r / best.count / 255, g = best.g / best.count / 255, b = best.b / best.count / 255;
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  const hue = (high === r ? (g - b) / delta + (g < b ? 6 : 0) : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  const saturation = Math.min(.85, Math.max(.5, delta / (1 - Math.abs(high + low - 1))));
  return `hsl(${Math.round(hue)} ${Math.round(saturation * 100)}% 70%)`;
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
  if (!url) return { url: null, accent: neutralAccent, cors: false };
  const cached = artworkCache.get(url); if (cached) return cached;
  const pending = inflight.get(url); if (pending) return pending;
  const task = (async () => {
    let image: HTMLImageElement, cors = true;
    // YouTube's JPEG variant permits canvas access; the equivalent WebP often does not.
    const parsed = new URL(url);
    const corsUrl = parsed.hostname === 'i.ytimg.com' && /^\/vi_webp\/[\w-]{11}\/[^/]+\.webp$/.test(parsed.pathname)
      ? `https://i.ytimg.com${parsed.pathname.replace('/vi_webp/', '/vi/').replace(/\.webp$/, '.jpg')}` : url;
    try { image = await imageLoad(corsUrl, true); }
    catch { cors = false; try { image = await imageLoad(url, false); } catch { return { url: null, accent: neutralAccent, cors: false }; } }
    let accent = neutralAccent;
    if (cors) {
      try {
        const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) { context.drawImage(image, 0, 0, 48, 48); accent = artworkAccent(context.getImageData(0, 0, 48, 48).data); }
      } catch { /* A host without canvas access still gets a fully loaded cover. */ }
    }
    const value = { url: cors ? corsUrl : url, accent, cors };
    if (artworkCache.size >= 64) artworkCache.delete(artworkCache.keys().next().value!);
    artworkCache.set(url, value); return value;
  })();
  inflight.set(url, task);
  try { return await task; } finally { inflight.delete(url); }
}
export function MediaCover({ url, onAccent }: { url: string | null; onAccent: (color: string) => void }) {
  // Browser caches must only affect effects, never the initial hydrated markup.
  const [layers, setLayers] = useState<Layer[]>([{ url: null, accent: neutralAccent, cors: false, id: 0, visible: true }]);
  const sequence = useRef(0);
  const onColor = useRef(onAccent); onColor.current = onAccent;
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
        onColor.current(artwork.accent);
        timers.add(setTimeout(() => setLayers((previous) => previous.filter((layer) => layer.id >= id)), fadeMs + 80));
      }); });
    });
    return () => { cancelled = true; cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); timers.forEach(clearTimeout); };
  }, [url]);
  return <span className="media-artwork media-artwork-large media-cover-stack" aria-hidden="true">{layers.map((layer) => <span key={layer.id} className={`media-cover-layer${layer.visible ? ' is-visible' : ''}`} onTransitionEnd={(event) => {
    if (event.target === event.currentTarget && event.propertyName === 'opacity' && layer.visible) setLayers((previous) => previous.filter((item) => item.id >= layer.id));
  }}>{layer.url ? <img src={layer.url} alt="" width="220" height="220" crossOrigin={layer.cors ? 'anonymous' : undefined} referrerPolicy="no-referrer" /> : <MediaIcon name="music" width="64" height="64" />}</span>)}</span>;
}
