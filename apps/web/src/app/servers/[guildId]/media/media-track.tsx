'use client';
import { useState } from 'react';
import type { MediaTrack } from '@scrt/shared';
import { MediaIcon } from './media-icon';

export const providerNames = { direct: 'Аудіофайл', radio: 'Радіо', youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify' };
export function MediaArtwork({ track, large = false }: { track: MediaTrack | null; large?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null); const url = track?.artworkUrl;
  return <span className={`media-artwork${large ? ' media-artwork-large' : ''}`}>{url && failed !== url ? <img src={url} alt="" width={large ? 220 : 52} height={large ? 220 : 52} loading={large ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setFailed(url)} /> : <MediaIcon name="music" width={large ? 64 : 24} height={large ? 64 : 24} />}</span>;
}
export function mediaTime(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
