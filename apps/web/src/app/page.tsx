import { redirect } from 'next/navigation';
import { accessToken, hasSession } from '@/lib/session';
import { isDevelopment } from '@/lib/application-environment';
import { AuthScreen } from './components/auth/auth-screen';

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  if (await accessToken()) redirect('/servers');
  if (await hasSession()) redirect('/api/auth/refresh?next=%2Fservers');
  return <AuthScreen development={isDevelopment} error={(await searchParams).error} />;
}
