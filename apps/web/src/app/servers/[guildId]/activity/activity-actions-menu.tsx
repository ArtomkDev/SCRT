'use client';
import { lazy, Suspense, useEffect, useId, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { ActivityArtwork, ArtworkIdentity } from '@scrt/shared';
import { InlineAction } from '@/app/components/inline-action';
import { Tooltip } from '@/app/components/tooltip';
import { setActivityGameIgnored } from './actions';
import { refreshActivityArtwork } from './artwork-actions';

const ArtworkEditor = lazy(() => import('./artwork-editor').then((module) => ({ default: module.ArtworkEditor })));
type MenuProps = { guildId: string; identity: ArtworkIdentity; artwork?: ActivityArtwork | null; href: string; canManage: boolean; ignored?: boolean; detail?: boolean };

export function ActivityActionsMenu({ guildId, identity, artwork, href, canManage, ignored = false, detail = false }: MenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId(); const router = useRouter();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [editor, setEditor] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function dismiss(restore = true) { setPosition(null); if (restore) trigger.current?.focus(); }
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPosition(null);
    };
    const reposition = () => setPosition(null);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [position]);

  function toggle() {
    if (position) { dismiss(); return; }
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 260)), left: Math.max(8, Math.min(bounds.right - 244, window.innerWidth - 252)) });
    setError('');
  }
  function act(action: 'refresh' | 'ignore') {
    if (!canManage || pending) return;
    const form = new FormData(); form.set('gameKey', identity.gameKey);
    if (action === 'ignore') form.set('mode', ignored ? 'track' : 'ignore');
    setError('');
    startTransition(async () => {
      try {
        if (action === 'refresh') await refreshActivityArtwork(guildId, form);
        else await setActivityGameIgnored(guildId, form);
        if (detail && action === 'ignore' && !ignored) router.push(href.replace(/\/games\/[^?]+/u, '/games'));
        router.refresh(); dismiss();
      } catch { setError('Не вдалося виконати дію. Спробуйте ще раз.'); }
    });
  }

  return <span className="activity-actions"><Tooltip label="Дії активності"><button ref={trigger} className="activity-menu-trigger" type="button" aria-label={`Дії: ${identity.displayName}`} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined} onClick={toggle} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); toggle(); } }}>•••</button></Tooltip>
    {position && createPortal(<div ref={menu} id={id} className="activity-action-menu" role="menu" aria-label={`Дії: ${identity.displayName}`} style={position} onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setPosition(null); }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      {!detail && <InlineAction role="menuitem" href={href} onClick={() => dismiss(false)}>Відкрити</InlineAction>}
      <InlineAction role="menuitem" href={href + '#contributors'} onClick={() => dismiss(false)}>Гравці</InlineAction>
      {canManage && <><div className="activity-menu-divider" role="separator" /><button role="menuitem" type="button" disabled={pending} onClick={() => { dismiss(); setEditor(true); }}>Оформлення</button><button role="menuitem" type="button" disabled={pending} onClick={() => act('refresh')}>Оновити оформлення автоматично</button><button role="menuitem" className={ignored ? undefined : 'activity-menu-danger'} type="button" disabled={pending} onClick={() => act('ignore')}>{ignored ? 'Відстежувати активність' : 'Ігнорувати'}</button></>}
      {pending && <p role="status">Збереження…</p>}{error && <p role="alert">{error}</p>}
    </div>, document.body)}
    {editor && canManage && <Suspense fallback={<span role="status">Завантаження оформлення…</span>}><ArtworkEditor guildId={guildId} identity={identity} artwork={artwork} returnFocus={trigger.current} close={() => setEditor(false)} /></Suspense>}
  </span>;
}
