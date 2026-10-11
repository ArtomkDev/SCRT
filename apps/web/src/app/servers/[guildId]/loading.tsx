import { LoadingValue } from '@/app/components/data-loading';
import { Panel, DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';
export default function Loading() { return <DashboardScreen aria-label="Завантаження сервера…" aria-busy="true" header={<ScreenHeader title="Сервер" />}><Panel className="detail-panel"><LoadingValue width="18ch" /></Panel></DashboardScreen>; }
