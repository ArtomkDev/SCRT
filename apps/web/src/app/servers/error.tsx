'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="content-page"><h1>Не вдалося завантажити сервери.</h1><button onClick={reset} className="primary-link error-retry">Спробувати ще раз</button></main>; }
