export default function AccessLoading() {
  return <main className="content-page access-control-page" aria-label="Завантаження доступу" aria-busy="true">
    <div className="page-heading"><h1>Керування доступом</h1><p className="muted">Завантаження налаштувань доступу…</p></div>
    <section className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton access-loading-avatar" /><div className="skeleton skeleton-line" /></section>
    <div className="access-role-sections"><section><div className="access-role-section-head"><h2>Повний доступ</h2></div><div className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div></section>
      <section><div className="access-role-section-head"><h2>Налаштування бота</h2></div><div className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div></section>
      <section><div className="access-role-section-head"><h2>Лише перегляд</h2></div><div className="detail-panel access-loading-card"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div></section></div>
  </main>;
}
