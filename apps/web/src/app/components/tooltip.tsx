'use client';

import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

export function Tooltip({ label, children }: { label: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function cancelHide() { if (timer.current) clearTimeout(timer.current); }
  function show() {
    cancelHide();
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ left: Math.max(8, Math.min(window.innerWidth - 288, bounds.right + 10)), top: Math.max(24, Math.min(window.innerHeight - 24, bounds.top + bounds.height / 2)) });
  }
  function hide() { cancelHide(); timer.current = setTimeout(() => setPosition(null), 120); }
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); document.removeEventListener('keydown', escape); };
  }, [position]);
  useEffect(() => () => cancelHide(), []);
  return <span ref={trigger} className="tooltip-trigger" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
    {cloneElement(children, { 'aria-describedby': position ? id : undefined })}
    {position && createPortal(<span id={id} role="tooltip" className="app-tooltip" style={position} onMouseEnter={cancelHide} onMouseLeave={hide}>{label}</span>, document.body)}
  </span>;
}
