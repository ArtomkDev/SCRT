import { LoadingValue } from '../components/data-loading';

export function ServerGroupsLoading() {
  return <div aria-label="Завантаження списку серверів…" aria-busy="true">{['Підключені сервери', 'Доступні для підключення'].map((title) => <section key={title} className="server-group"><div className="section-heading"><h2>{title}</h2><LoadingValue width="2ch" /></div><div className="server-grid">{[0, 1].map((index) => <article key={index} className="server-card"><span className="guild-icon" style={{ width: 48, height: 48 }} aria-hidden="true" /><div className="server-card-copy"><h3><LoadingValue width="16ch" /></h3><p><LoadingValue width="12ch" /></p></div></article>)}</div></section>)}</div>;
}
