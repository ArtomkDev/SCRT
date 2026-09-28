'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="p-8"><p>Could not load servers. Check your connection and try again.</p><button onClick={reset} className="mt-4 text-indigo-400">Retry</button></main>; }
