'use client';
import { DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';
import { Button } from '@/app/components/controls';
export default function ErrorPage({ retry }: { retry: () => void }) { return <DashboardScreen header={<ScreenHeader title="Не вдалося завантажити сервери." />}><Button onClick={retry}>Повторити</Button></DashboardScreen>; }
