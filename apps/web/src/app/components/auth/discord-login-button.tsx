'use client';

import { useEffect, useState } from 'react';
import { DiscordIcon } from './discord-icon';

export function DiscordLoginButton({ retry = false }: { retry?: boolean }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  return <a href="/api/auth/login" className="auth-discord-button" aria-disabled={pending || undefined} aria-busy={pending || undefined}
    onClick={(event) => {
      if (pending) { event.preventDefault(); return; }
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setPending(true);
    }}>
    {pending ? <svg className="auth-spinner" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".25" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> : <DiscordIcon />}
    <span aria-live="polite">{pending ? 'Переходимо до Discord…' : retry ? 'Спробувати ще раз через Discord' : 'Увійти через Discord'}</span>
  </a>;
}
