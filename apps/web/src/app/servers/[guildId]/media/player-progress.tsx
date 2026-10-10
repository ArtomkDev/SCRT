'use client';
import React, { useState, type CSSProperties } from 'react';
import type { MediaTrack } from '@scrt/shared';
import { mediaTime } from './media-track';

export function PlayerProgress({ track, progress, maxDurationMs, canSeek, onSeek }: { track: MediaTrack | null; progress: number; maxDurationMs: number; canSeek: boolean; onSeek: (positionMs: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const duration = track?.durationMs ?? maxDurationMs;
  const maximum = Math.max(0, Math.floor((duration - 1) / 1000) * 1000);
  const displayed = draft ?? progress;
  function commit() {
    if (draft === null || !canSeek) return;
    onSeek(Math.min(maximum, Math.max(0, draft))); setDraft(null);
  }
  return <div className="media-progress">
    <div className="media-progress-bar">
    {canSeek ? <input type="range" className="media-seek" aria-label="Перемотати трек" aria-valuetext={mediaTime(displayed)} min={0} max={maximum} step={1000} value={Math.min(displayed, maximum)} style={{ '--seek-fill': `${duration ? Math.min(100, displayed / duration * 100) : 0}%` } as CSSProperties}
      onChange={(event) => setDraft(Number(event.target.value))} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerUp={commit} onPointerCancel={() => setDraft(null)} onBlur={() => setDraft(null)} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(); }} />
      : <progress value={progress} max={duration} aria-label="Прогрес відтворення" title={track?.seekable ? 'Перемотування потребує дозволу на керування треком.' : 'Це джерело не підтримує перемотування.'} />}
    </div>
    <div className="media-progress-times"><span>{mediaTime(displayed)}</span><span>{track?.type === 'live' ? 'LIVE' : track?.durationMs ? mediaTime(track.durationMs) : '—'}</span></div>
  </div>;
}
