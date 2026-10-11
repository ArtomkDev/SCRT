import { Panel, DashboardScreen, ScreenHeader } from '@/app/components/dashboard-screen';
export default function AccessLoading() {
  return <DashboardScreen width="compact" className="access-control-page" aria-label="Завантаження доступу" aria-busy="true" header={<ScreenHeader title="Керування доступом" description="Доступ до панелі SCRT за ролями Discord та для окремих учасників." />}>
    <Panel className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton access-loading-avatar" /><div className="skeleton skeleton-line" /></Panel>
    <div className="access-role-sections"><section><div className="access-role-section-head"><h2>Повний доступ</h2></div><Panel as="div" className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></Panel></section>
      <section><div className="access-role-section-head"><h2>Налаштування бота</h2></div><Panel as="div" className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></Panel></section>
      <section><div className="access-role-section-head"><h2>Лише перегляд</h2></div><Panel as="div" className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></Panel></section></div>
  </DashboardScreen>;
}
