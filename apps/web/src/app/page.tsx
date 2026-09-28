import Link from 'next/link';
import { accessToken } from '@/lib/session';

export default async function Home() {
  const signedIn = Boolean(await accessToken());
  return <main className="login-page"><div className="login-panel"><div className="brand">SCRT <span>CONTROL</span></div><h1>Керування вашими Discord-серверами</h1><p>Налаштуйте SCRT на серверах, якими керуєте.</p><Link href={signedIn ? '/dashboard' : '/api/auth/login'} className="primary-link">{signedIn ? 'Відкрити огляд' : 'Увійти через Discord'}</Link></div></main>;
}
