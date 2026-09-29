import { redirect } from 'next/navigation';
import { accessToken, hasSession } from '@/lib/session';

export default async function Home() {
  if (await accessToken()) redirect('/servers');
  if (await hasSession()) redirect('/api/auth/refresh?next=%2Fservers');
  return <main className="login-page"><div className="login-panel"><div className="brand">SCRT <span>CONTROL</span></div><h1>Увійдіть, щоб керувати SCRT</h1><p>Для доступу до SCRT Control потрібно увійти через Discord. Після входу ви зможете вибрати сервер і налаштувати бота.</p><a href="/api/auth/login" className="primary-link">Продовжити через Discord</a></div></main>;
}
