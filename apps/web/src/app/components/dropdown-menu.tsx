'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './controls';

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

export function DropdownMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  function dismiss(restore = true) { setPosition(null); if (restore) trigger.current?.focus(); }
  function show() {
    if (position) { dismiss(); return; }
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - items.length * 40 - 24)), left: Math.max(8, Math.min(bounds.right - 240, window.innerWidth - 248)) });
  }
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPosition(null); };
    const reposition = () => setPosition(null);
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [position]);
  return <span className="ui-menu"><Button ref={trigger} variant="icon" aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined} onClick={show} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } }}>•••</Button>
    {position && createPortal(<div ref={menu} id={id} className="ui-dropdown-menu" role="menu" aria-label={label} style={position} onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setPosition(null); }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
      if (event.key === 'Tab') { dismiss(false); trigger.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const choices = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
        const index = choices.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        choices[next]?.focus();
      }
    }}>{items.map((item) => <button key={item.label} type="button" role="menuitem" className={item.danger ? 'ui-menu-danger' : undefined} disabled={item.disabled} onClick={() => { dismiss(); item.onSelect(); }}>{item.label}</button>)}</div>, trigger.current?.closest('dialog') ?? document.body)}
  </span>;
}
