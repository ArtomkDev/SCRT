import { DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';
export default function SectionLoading() {
  return <DashboardScreen aria-label="Завантаження розділу" aria-busy="true" header={<ScreenHeader title="Розділ" />}><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /></DashboardScreen>;
}
