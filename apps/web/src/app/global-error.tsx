'use client';

import { useEffect } from 'react';
import { isNavigationNetworkError, recoverNavigationNetworkError } from '@/lib/navigation-recovery';
import './global-error.css';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => recoverNavigationNetworkError(error, () => window.location.reload()), [error]);
  return <html lang="uk"><body className="recovery-page"><main className="recovery-card" role="alert">
    <h1>Не вдалося завантажити сторінку</h1>
    <p>{isNavigationNetworkError(error) ? 'З’єднання перервалося під час завантаження. Оновіть сторінку, щоб спробувати ще раз.' : 'Спробуйте оновити сторінку. Якщо помилка повторюється, зверніться до адміністратора.'}</p>
    <div className="recovery-actions"><button type="button" onClick={() => window.location.reload()}>Оновити сторінку</button><a href="/servers">До серверів</a></div>
  </main></body></html>;
}
