'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="content-page"><h1>Не вдалося завантажити сервер.</h1><p className="muted">Перевірте доступ і спробуйте ще раз.</p><button onClick={reset} className="primary-link error-retry">Спробувати ще раз</button></main>; }
