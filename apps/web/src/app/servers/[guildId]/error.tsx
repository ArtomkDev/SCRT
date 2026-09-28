'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="p-8"><p>Could not load this server. You may no longer have access, or Discord is unavailable.</p><button onClick={reset} className="mt-4 text-indigo-400">Retry</button></main>; }
