'use client';
export default function ErrorPage({ retry }: { retry: () => void }) { return <main className="content-page"><h1>Не вдалося завантажити сервери.</h1><button onClick={retry} className="primary-link error-retry">Повторити</button></main>; }
