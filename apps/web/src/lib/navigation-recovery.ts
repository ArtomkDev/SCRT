const recoveryKey = 'scrt:network-recovery-at';
const recoveryCooldownMs = 60_000;

export function isNavigationNetworkError(error: Error & { digest?: string }): boolean {
  return !error.digest && error.name === 'TypeError' && /^(?:network error|failed to fetch|fetch failed|load failed|networkerror when attempting to fetch resource\.?)$/iu.test(error.message.trim());
}

/** Recover a broken Flight decoder through a fresh document, once per minute. */
export function recoverNavigationNetworkError(error: Error & { digest?: string }, reload: () => void): () => void {
  if (!isNavigationNetworkError(error)) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  function resume() {
    if (timer !== null || document.hidden || !navigator.onLine) return;
    timer = setTimeout(() => {
      timer = null;
      if (document.hidden || !navigator.onLine) return;
      try {
        const stored = sessionStorage.getItem(recoveryKey);
        if (stored !== null && Number.isFinite(Number(stored)) && Number(stored) > Date.now() - recoveryCooldownMs) return;
        // Persist before navigating: repeated failures must not create a reload loop.
        sessionStorage.setItem(recoveryKey, String(Date.now()));
      } catch { return; } // Keep the manual reload when storage is unavailable.
      reload();
    }, 300);
  }
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  resume();
  return () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
