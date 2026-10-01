'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="content-page"><h1>Не вдалося завантажити сервер.</h1><p className="muted">Спробуйте ще раз. Якщо помилка повторюється, зверніться до адміністратора.</p><button onClick={reset} className="primary-link error-retry">Повторити</button></main>; }
