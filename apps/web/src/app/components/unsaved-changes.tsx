'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type DirtyForm = { save: () => void; discard: () => void };
type UnsavedContext = { setDirty: (id: string, form: DirtyForm | null) => void; hasChanges: boolean };
const Context = createContext<UnsavedContext | null>(null);

export function useUnsavedChanges() {
  const context = useContext(Context);
  if (!context) throw new Error('UnsavedChangesProvider is missing');
  return context;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [forms, setForms] = useState<Record<string, DirtyForm>>({});
  const [blockedAttempts, setBlockedAttempts] = useState(0);
  const banner = useRef<HTMLElement>(null);
  const formsRef = useRef(forms);
  formsRef.current = forms;
  const hasChanges = Object.keys(forms).length > 0;
  const blocked = blockedAttempts > 0;

  const setDirty = useCallback((id: string, form: DirtyForm | null) => {
    setForms((current) => {
      if (!form && !current[id]) return current;
      if (form && current[id]) return current;
      const next = { ...current };
      if (form) next[id] = form;
      else delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasChanges) { setBlockedAttempts(0); return; }
    const warn = () => setBlockedAttempts((count) => count + 1);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest('a[href]');
      if (!link || (link instanceof HTMLAnchorElement && link.target && link.target !== '_self')) return;
      const next = new URL(link.getAttribute('href')!, location.href);
      if (next.origin === location.origin && next.pathname === location.pathname && next.search === location.search) return;
      event.preventDefault();
      event.stopPropagation();
      warn();
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.hasAttribute('action')) return;
      event.preventDefault();
      event.stopPropagation();
      warn();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onNavigate = (event: Event) => {
      const navigation = event as Event & { destination?: { url: string } };
      if (!event.cancelable || !navigation.destination) return;
      const next = new URL(navigation.destination.url);
      if (next.origin === location.origin && next.pathname === location.pathname && next.search === location.search) return;
      event.preventDefault();
      warn();
    };
    const browserNavigation = (window as Window & { navigation?: EventTarget }).navigation;
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    browserNavigation?.addEventListener('navigate', onNavigate);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      browserNavigation?.removeEventListener('navigate', onNavigate);
    };
  }, [hasChanges]);

  useEffect(() => {
    if (blockedAttempts > 0) banner.current?.focus({ preventScroll: true });
  }, [blockedAttempts]);

  const value = useMemo(() => ({ setDirty, hasChanges }), [setDirty, hasChanges]);
  return <Context.Provider value={value}>{children}{hasChanges && <aside key={blockedAttempts} ref={banner} className={`unsaved-banner${blocked ? ' unsaved-banner-blocked' : ''}`} role={blocked ? 'alert' : 'status'} aria-live={blocked ? 'assertive' : 'polite'} tabIndex={-1}>
    <div><strong>{blocked ? 'Перехід зупинено' : 'Є незбережені зміни'}</strong><span>Збережіть або скасуйте зміни, щоб перейти на інший екран.</span></div>
    <div className="unsaved-actions"><button type="button" className="secondary-button" onClick={() => Object.values(formsRef.current).forEach((form) => form.discard())}>Скасувати зміни</button><button type="button" className="action-link" onClick={() => Object.values(formsRef.current)[0]?.save()}>Зберегти{Object.keys(forms).length > 1 ? ' поточну форму' : ''}</button></div>
  </aside>}</Context.Provider>;
}
