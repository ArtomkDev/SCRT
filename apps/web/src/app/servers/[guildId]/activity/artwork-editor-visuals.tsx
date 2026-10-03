'use client';
import { useEffect, useState } from 'react';
import { artworkIdentity, type ArtworkAsset, type ArtworkIdentity } from '@scrt/shared';
import { artworkSourceLabel, candidateDimensions, type ArtworkCandidate, type ArtworkField } from '@/lib/artwork-editor';
import { artworkImageFailed, rememberArtworkImageFailure } from '@/lib/artwork-image-state';

export function ArtworkVisual({ url, kind, identity, className = '', onFailure }: { url?: string; kind: ArtworkAsset['kind']; identity: ArtworkIdentity; className?: string; onFailure?: () => void }) {
  const [failed, setFailed] = useState<string | undefined>();
  const [loaded, setLoaded] = useState<string | undefined>();
  const fallback = artworkIdentity(identity.gameKey, identity.displayName);
  const broken = Boolean(url && (failed === url || artworkImageFailed(url)));
  useEffect(() => { if (broken) onFailure?.(); }, [broken, onFailure]);
  return <span className={`artwork-visual artwork-visual-${kind} ${className}`} style={{ backgroundColor: fallback.background }}>
    <span className="artwork-visual-initials" aria-hidden="true">{fallback.initials}</span>
    {url && !broken && <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ opacity: loaded === url ? 1 : 0 }} onLoad={() => setLoaded(url)} onError={() => { rememberArtworkImageFailure(url); setFailed(url); }} />}
  </span>;
}

export function ArtworkResultCard({ candidate, identity, selected, current, disabled, index, choose }: { candidate: ArtworkCandidate; identity: ArtworkIdentity; selected: boolean; current: boolean; disabled: boolean; index: number; choose: () => void }) {
  const [failed, setFailed] = useState(false);
  const dimensions = candidateDimensions(candidate);
  const provider = artworkSourceLabel(candidate.asset.source);
  return <button type="button" className="artwork-candidate" aria-label={`${provider}, варіант ${index + 1}${dimensions ? ', ' + dimensions : ''}`} aria-pressed={selected} disabled={disabled || failed} onClick={choose}>
    <ArtworkVisual url={candidate.previewUrl} kind={candidate.asset.kind} identity={identity} onFailure={() => setFailed(true)} />
    <span className="artwork-candidate-meta"><span>{provider}</span>{dimensions && <small>{dimensions}</small>}</span>
    <span className="artwork-candidate-state">{failed ? 'Недоступне' : selected ? '✓ Обрано' : current ? 'Поточне' : '\u00a0'}</span>
  </button>;
}

export function ArtworkPreview({ identity, field, asset, automatic, ratio, onFailure }: { identity: ArtworkIdentity; field: ArtworkField; asset: ArtworkAsset | null; automatic: boolean; ratio: number; onFailure: () => void }) {
  return <aside className="artwork-preview" aria-label="Попередній перегляд">
    <h3>Попередній перегляд</h3>
    <div className={`artwork-preview-frame artwork-preview-${field}`} style={field === 'hero' ? { aspectRatio: ratio } : undefined}>
      <ArtworkVisual url={asset?.url} kind={field === 'hero' ? 'hero' : asset?.kind ?? 'icon'} identity={identity} onFailure={onFailure} />
      {field === 'hero' && <div className="artwork-preview-identity">{identity.displayName}</div>}
    </div>
    <p>{automatic ? 'Автоматичний вибір' : asset ? artworkSourceLabel(asset.source) : 'Створене оформлення'}</p>
    <small>{automatic ? 'Після застосування використовуватиметься рекомендоване оформлення. Ручний вибір для цього поля буде скинуто.' : field === 'hero' ? 'Таке кадрування використовується на сторінці активності.' : 'Логотип зберігає пропорції. Обкладинка заповнює рамку.'}</small>
    {asset?.attributionUrl && <a className="artwork-preview-source" href={asset.attributionUrl} target="_blank" rel="noreferrer">Переглянути джерело ↗</a>}
  </aside>;
}
