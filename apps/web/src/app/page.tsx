import Link from 'next/link';
import { accessToken } from '@/lib/session';

export default async function Home() {
  const signedIn = Boolean(await accessToken());
  return <main className="min-h-screen flex items-center justify-center p-6"><div className="max-w-xl rounded-3xl border border-slate-700 bg-slate-900 p-10 shadow-2xl"><div className="mb-3 text-sm font-bold tracking-[.3em] text-indigo-400">SCRT CONTROL</div><h1 className="text-4xl font-semibold">Your servers, under control.</h1><p className="mt-4 text-slate-400">A private-first control platform for your Discord communities. Sign in to see servers you can manage.</p><Link href={signedIn ? '/servers' : '/api/auth/login'} className="mt-8 inline-block rounded-xl bg-indigo-500 px-5 py-3 font-semibold text-white hover:bg-indigo-400">{signedIn ? 'Open dashboard' : 'Login with Discord'}</Link></div></main>;
}
