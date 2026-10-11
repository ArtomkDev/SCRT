'use client';
import { DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';
import { Button } from '@/app/components/controls';
export default function ErrorPage({ retry }: { retry: () => void }) { return <DashboardScreen header={<ScreenHeader title="Не вдалося завантажити сервер." description="Спробуйте ще раз. Якщо помилка повторюється, зверніться до адміністратора." />}><Button onClick={retry}>Повторити</Button></DashboardScreen>; }
