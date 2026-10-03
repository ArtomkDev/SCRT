'use client';
import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { effectiveArtwork, type ActivityArtwork, type ArtworkAsset, type ArtworkIdentity } from '@scrt/shared';
import { artworkCandidates, artworkSources, type ArtworkCandidate, type ArtworkField, type GallerySource } from '@/lib/artwork-editor';
import { selectActivityArtwork } from './artwork-actions';
import { useArtworkSearch } from './use-artwork-search';
import { ArtworkPreview, ArtworkResultCard, ArtworkVisual } from './artwork-editor-visuals';

type Draft = { mode: 'candidate'; candidate: ArtworkCandidate } | { mode: 'url'; url: string } | { mode: 'upload'; file: File; url: string } | { mode: 'automatic' };
export type ArtworkEditorProps = { guildId: string; identity: ArtworkIdentity; artwork?: ActivityArtwork | null; close: () => void; initialField?: ArtworkField; returnFocus?: HTMLElement | null };

function heroRatio() {
  const hero = document.querySelector('.activity-artwork-hero');
  if (hero) { const bounds = hero.getBoundingClientRect(); if (bounds.height) return bounds.width / bounds.height; }
  const content = document.querySelector('.activity-content');
  const width = content ? content.clientWidth - parseFloat(getComputedStyle(content).paddingLeft) - parseFloat(getComputedStyle(content).paddingRight) : Math.min(window.innerWidth - 32, 1300);
  return width / (window.innerWidth <= 640 ? 160 : 240);
}
function manualAsset(url: string, field: ArtworkField): ArtworkAsset {
  return { url, source: 'manual', kind: field, entityId: null, attributionUrl: null };
}

export function ArtworkEditor({ guildId, identity, artwork, initialField = 'icon', close, returnFocus }: ArtworkEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const customUrl = useRef<HTMLInputElement>(null);
  const customFile = useRef<HTMLInputElement>(null);
  const id = useId(); const router = useRouter();
  const [field, setField] = useState(initialField);
  const [filter, setFilter] = useState<GallerySource | 'all'>('all');
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failedPreview, setFailedPreview] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const [ratio, setRatio] = useState(heroRatio);
  const { results, query, searched, search, refine, more } = useArtworkSearch(guildId, identity.gameKey, artwork?.revision ?? 0, identity.displayName);
  const current = effectiveArtwork(artwork, field);
  const candidates = artworkCandidates(results, field, filter);
  const loading = artworkSources.some(([source]) => (filter === 'all' || filter === source) && results[field][source]?.loading);
  const unavailable = artworkSources.filter(([source]) => results[field][source]?.unavailable);
  const automatic = draft?.mode === 'automatic';
  const preview = draft?.mode === 'candidate' ? draft.candidate.asset : draft?.mode === 'url' || draft?.mode === 'upload' ? manualAsset(draft.url, field) : automatic ? artwork?.[field] ?? null : current;
  const previewFailure = useCallback(() => setFailedPreview(true), []);

  useEffect(() => {
    const node = dialog.current;
    const trigger = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (node && !node.open) node.showModal();
    const resize = () => setRatio(heroRatio());
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); document.body.style.overflow = overflow; node?.close(); trigger?.focus(); };
  }, [returnFocus]);
  useEffect(() => {
    const url = draft?.mode === 'upload' ? draft.url : null;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [draft]);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [field]);

  function choose(value: Draft | null) { setDraft(value); setError(''); setFailedPreview(false); }
  function changeField(target: ArtworkField) { setField(target); choose(null); }
  function apply() {
    if (!draft || submitting.current || pending || failedPreview && !automatic) return;
    const form = new FormData();
    form.set('gameKey', identity.gameKey); form.set('field', field); form.set('mode', draft.mode);
    if (draft.mode === 'candidate') form.set('token', draft.candidate.token);
    if (draft.mode === 'url') form.set('url', draft.url);
    if (draft.mode === 'upload') form.set('file', draft.file);
    submitting.current = true; setError('');
    startTransition(async () => {
      try { await selectActivityArtwork(guildId, form); router.refresh(); close(); }
      catch { setError('Не вдалося зберегти оформлення. Спробуйте ще раз.'); }
      finally { submitting.current = false; }
    });
  }
  function previewUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('url') ?? '').trim();
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid URL');
      choose({ mode: 'url', url: value });
    } catch { setError('Вкажіть коректний HTTPS URL зображення.'); }
  }

  return createPortal(<dialog ref={dialog} className={`artwork-dialog artwork-dialog-${field}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onClose={(event) => { if (!event.currentTarget.open) close(); }} onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <header className="artwork-dialog-header"><div><h2 id={`${id}-title`}>Оформлення</h2><p id={`${id}-description`} title={identity.displayName}>{identity.displayName}</p></div><button type="button" className="artwork-close" disabled={pending} onClick={close} aria-label="Закрити оформлення">×</button></header>
    <div className="artwork-type-tabs" role="tablist" aria-label="Тип оформлення">{([['icon', 'Іконка'], ['hero', 'Банер']] as const).map(([target, label]) => <button key={target} id={`${id}-${target}`} type="button" role="tab" aria-selected={field === target} aria-controls={`${id}-panel`} tabIndex={field === target ? 0 : -1} disabled={pending} onClick={() => changeField(target)} onKeyDown={(event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 'icon' : event.key === 'End' ? 'hero' : field === 'icon' ? 'hero' : 'icon';
        changeField(next); document.getElementById(`${id}-${next}`)?.focus();
      }
    }}>{label}</button>)}</div>
    <div ref={body} className="artwork-dialog-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${field}`} tabIndex={0}>
      <section className="artwork-current" aria-label={field === 'icon' ? 'Поточна іконка' : 'Поточний банер'}><ArtworkVisual url={current?.url} kind={field === 'hero' ? 'hero' : current?.kind ?? 'icon'} identity={identity} /><div><h3>{field === 'icon' ? 'Поточна іконка' : 'Поточний банер'}</h3><p>Використовується зараз{artwork?.overrides[field === 'icon' ? 'iconUrl' : 'heroUrl'] && <span> · Вибрано вручну</span>}</p></div></section>
      <div className="artwork-methods" aria-label="Спосіб вибору"><button type="button" aria-pressed={!custom} disabled={pending} onClick={() => { setCustom(false); choose(null); }}>Знайти</button><button type="button" aria-pressed={custom} disabled={pending} onClick={() => { setCustom(true); choose(null); }}>Власне зображення</button></div>
      <div className="artwork-editor-workspace">
        <div className="artwork-editor-options">
          {!custom ? <>
            <form className="artwork-search" onSubmit={(event) => { event.preventDefault(); search(String(new FormData(event.currentTarget).get('query') ?? '')); }}><label>Пошук оформлення<input name="query" defaultValue={query} maxLength={128} required disabled={pending} /></label><button className="secondary-button" type="submit" disabled={pending}>Знайти</button></form>
            <label className="artwork-provider-filter">Джерело<select value={filter} disabled={pending} onChange={(event) => setFilter(event.target.value as GallerySource | 'all')}><option value="all">Усі</option>{artworkSources.map(([source, label]) => <option value={source} key={source}>{label}</option>)}</select></label>
            <div className="artwork-results-heading"><h3>Варіанти оформлення</h3>{candidates.length > 0 && <small>{candidates.length} результатів</small>}</div>
            {loading && <p className="artwork-search-status" role="status">Пошук оформлення…</p>}
            <div className="artwork-gallery" aria-busy={loading}>{candidates.map((candidate, index) => <ArtworkResultCard key={field + candidate.asset.url} identity={identity} candidate={candidate} index={index} selected={draft?.mode === 'candidate' && draft.candidate.asset.url === candidate.asset.url} current={current?.url === candidate.asset.url} disabled={pending} choose={() => choose({ mode: 'candidate', candidate })} />)}{loading && !candidates.length && Array.from({ length: field === 'icon' ? 12 : 4 }, (_, index) => <div key={index} className="artwork-skeleton" aria-hidden="true" />)}</div>
            {!loading && !candidates.length && <div className="artwork-search-empty"><p>{!searched ? 'Знайдіть оформлення за назвою активності.' : filter === 'all' ? 'Не вдалося знайти відповідне оформлення.' : 'У цьому джерелі немає відповідного оформлення.'}</p><small>{!searched ? 'Пошуковий запит змінює лише пошук зображень.' : 'Змініть запит, використайте власне зображення або автоматичний вибір.'}</small>{searched && <button type="button" className="secondary-button" onClick={() => { setCustom(true); choose(null); }}>Власне зображення</button>}</div>}
            {artworkSources.some(([source]) => (filter === 'all' || source === filter) && results[field][source]?.result?.nextPage != null) && <button className="secondary-button" type="button" disabled={loading || pending} onClick={() => more(field, filter)}>Показати ще</button>}
            {unavailable.length > 0 && <p className="field-help" role="status">{unavailable.map(([, label]) => label).join(', ')} {unavailable.length === 1 ? 'тимчасово недоступний' : 'тимчасово недоступні'}. Інші результати можна використовувати.</p>}
            {searched && <details className="artwork-game-choices"><summary>Інший збіг за назвою</summary><p className="field-help">Якщо знайдено іншу гру, уточніть збіг або змініть запит.</p>{artworkSources.filter(([source]) => Boolean(results[field][source]?.result?.games.length)).map(([source, label]) => <label key={source}>{label}<select disabled={loading || pending} value={results[field][source]?.entityId ?? ''} onChange={(event) => refine(source, event.target.value || undefined)}><option value="">Автоматичний збіг</option>{results[field][source]?.result?.games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>)}</details>}
          </> : <section className="artwork-custom" key={field}><h3>Власне зображення</h3><form onSubmit={previewUrl}><label>URL зображення<input ref={customUrl} type="url" name="url" placeholder="https://…" maxLength={2048} required disabled={pending} onChange={() => { if (customFile.current) customFile.current.value = ''; choose(null); }} /></label><button className="secondary-button" type="submit" disabled={pending}>Переглянути</button></form><div className="artwork-upload"><label>Завантажити зображення<input ref={customFile} type="file" accept="image/png,image/jpeg,image/webp" disabled={pending} onChange={(event) => {
            const file = event.target.files?.[0]; choose(null);
            if (customUrl.current) customUrl.current.value = '';
            if (!file) return;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError('Оберіть PNG, JPEG або WebP до 4 МБ.'); return; }
            choose({ mode: 'upload', file, url: URL.createObjectURL(file) });
          }} /></label><p className="field-help">Статичні PNG, JPEG або WebP до 4 МБ. Зображення збережеться після застосування.</p></div></section>}
        </div>
        <ArtworkPreview key={preview?.url ?? 'generated'} identity={identity} field={field} asset={preview} automatic={automatic} ratio={ratio} onFailure={previewFailure} />
      </div>
    </div>
    <footer className="artwork-dialog-footer"><div className="artwork-editor-feedback" aria-live="polite">{error ? <p role="alert">{error}</p> : pending ? <p role="status">Збереження оформлення…</p> : failedPreview && !automatic ? <p role="alert">Зображення недоступне. Оберіть інше.</p> : draft ? <p>Обрано нове оформлення. Застосуйте, щоб зберегти.</p> : <p>Зміни зберігаються лише після застосування.</p>}</div><div className="artwork-footer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={() => choose({ mode: 'automatic' })}>Автоматичний вибір</button><span /><button className="secondary-button" type="button" disabled={pending} onClick={close}>Скасувати</button><button className="action-link" type="button" disabled={!draft || pending || failedPreview && !automatic} onClick={apply}>Застосувати</button></div></footer>
  </dialog>, document.body);
}
