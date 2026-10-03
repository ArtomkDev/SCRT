'use client';
import { lazy, Suspense, useRef, useState } from 'react';
import type { ActivityArtwork, ArtworkIdentity } from '@scrt/shared';
const ArtworkEditor = lazy(() => import('./artwork-editor').then((module) => ({ default: module.ArtworkEditor })));

export function ArtworkPicker({ guildId, identity, artwork }: { guildId: string; identity: ArtworkIdentity; artwork?: ActivityArtwork | null }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <span className="artwork-picker"><button ref={trigger} className="secondary-button" type="button" onClick={() => setOpen(true)}>Оформлення</button>{open && <Suspense fallback={<span role="status">Завантаження оформлення…</span>}><ArtworkEditor guildId={guildId} identity={identity} artwork={artwork} returnFocus={trigger.current} close={() => setOpen(false)} /></Suspense>}</span>;
}
