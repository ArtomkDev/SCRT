'use client';
import { useState, type ReactNode } from 'react';
import { artworkIdentity, effectiveArtwork, type ActivityArtwork } from '@scrt/shared';
import { artworkImageFailed, rememberArtworkImageFailure } from '@/lib/artwork-image-state';

type IdentityProps = { gameKey: string; name: string; artwork?: ActivityArtwork | null };
export function ActivityIcon({ gameKey, name, artwork, size = 40 }: IdentityProps & { size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const asset = effectiveArtwork(artwork, 'icon');
  const identity = artworkIdentity(gameKey, name);
  const failed = asset && (failedUrl === asset.url || artworkImageFailed(asset.url));
  return <span className="activity-artwork-icon" style={{ width: size, height: size, background: identity.background }} aria-hidden="true">
    {(!asset || loadedUrl !== asset.url || failed) && <span className="activity-artwork-initials">{identity.initials}</span>}
    {asset && !failed && <img src={asset.url} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ opacity: loadedUrl === asset.url ? 1 : 0 }} className={asset.kind === 'cover' ? 'activity-artwork-cover' : undefined} onLoad={() => setLoadedUrl(asset.url)} onError={() => { rememberArtworkImageFailure(asset.url); setFailedUrl(asset.url); }} />}
  </span>;
}
export function ActivityHero({ gameKey, name, artwork, actions }: IdentityProps & { actions?: ReactNode }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hero = effectiveArtwork(artwork, 'hero');
  const icon = effectiveArtwork(artwork, 'icon');
  const identity = artworkIdentity(gameKey, name);
  const attributions = [...new Set([hero?.attributionUrl, icon?.attributionUrl].filter((url): url is string => Boolean(url)))];
  return <div className="activity-artwork-hero" style={{ backgroundColor: identity.background }}>
    <div className="activity-artwork-decoration" aria-hidden="true">{identity.initials}</div>
    {hero && hero.url !== failedUrl && !artworkImageFailed(hero.url) && <img className="activity-artwork-banner" src={hero.url} alt="" loading="eager" fetchPriority="high" decoding="async" referrerPolicy="no-referrer" onError={() => { rememberArtworkImageFailure(hero.url); setFailedUrl(hero.url); }} />}
    <div className="activity-artwork-overlay" aria-hidden="true" />
    <div className="activity-artwork-heading"><ActivityIcon gameKey={gameKey} name={name} artwork={artwork} size={64} /><div><h2 title={name}>{name}</h2><p>{artwork?.classification === 'application' ? 'Застосунок' : artwork?.classification === 'game' ? 'Гра' : 'Активність типу Playing'}</p></div></div>
    {actions && <div className="activity-artwork-actions">{actions}</div>}
    {attributions.length > 0 && <div className="activity-artwork-attribution">{attributions.map((url) => <a href={url} key={url} target="_blank" rel="noreferrer">{url.includes('steamgriddb') ? 'SteamGridDB' : url.includes('igdb') ? 'IGDB' : url.includes('visualstudio') ? 'Microsoft' : 'Джерело оформлення'}</a>)}</div>}
  </div>;
}
