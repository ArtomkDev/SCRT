'use client';
export default function ErrorPage({ retry }: { retry: () => void }) { return <main className="content-page"><h1>Не вдалося завантажити сервер.</h1><p className="muted">Спробуйте ще раз. Якщо помилка повторюється, зверніться до адміністратора.</p><button onClick={retry} className="primary-link error-retry">Повторити</button></main>; }
