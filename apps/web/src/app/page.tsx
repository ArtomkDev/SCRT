import { redirect } from 'next/navigation';
import { accessToken, hasSession } from '@/lib/session';

export default async function Home() {
  if (await accessToken()) redirect('/servers');
  if (await hasSession()) redirect('/api/auth/refresh?next=%2Fservers');
  return <main className="login-page"><div className="login-panel"><div className="brand">SCRT <span>CONTROL</span></div><h1>Вхід у SCRT</h1><p>Увійдіть через Discord, щоб відкрити налаштування бота на своєму сервері.</p><a href="/api/auth/login" className="primary-link">Увійти через Discord</a></div></main>;
}
