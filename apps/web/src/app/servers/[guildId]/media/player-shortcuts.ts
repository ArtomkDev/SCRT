'use client';
import { useEffect, useRef } from 'react';

type Shortcuts = { canToggle: boolean; canSeek: boolean; blocked: boolean; onToggle: () => void; onSeek: (deltaMs: number) => void; onSearch: () => void };
export function usePlayerShortcuts(options: Shortcuts) {
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || document.hidden || document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="button"]')) return;
      const current = latest.current;
      if (event.key === '/') { event.preventDefault(); current.onSearch(); }
      else if (!current.blocked && event.code === 'Space' && current.canToggle) { event.preventDefault(); current.onToggle(); }
      else if (!current.blocked && current.canSeek && ['KeyJ', 'KeyL'].includes(event.code)) { event.preventDefault(); current.onSeek(event.code === 'KeyJ' ? -10000 : 10000); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
}
