'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './controls';

export function Dialog({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  return <dialog ref={dialog} className="ui-dialog" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'))
      .filter((control) => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
    <header className="ui-dialog-header"><h2 id={titleId}>{title}</h2><Button variant="icon" aria-label="Закрити діалог" onClick={onClose}>×</Button></header>
    <div className="ui-dialog-body">{description && <p id={descriptionId} className="muted">{description}</p>}{open && children}</div>
    {footer && <footer className="ui-dialog-footer">{footer}</footer>}
  </dialog>;
}
