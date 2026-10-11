import { Panel, PanelHeader } from '@/app/components/dashboard-screen';
import { LoadingValue } from '../components/data-loading';

export function ServerGroupsLoading() {
  return <div aria-label="Завантаження списку серверів…" aria-busy="true">{['Підключені сервери', 'Доступні для підключення'].map((title) => <section key={title} className="server-group"><PanelHeader className="section-heading" title={title} actions={<LoadingValue width="2ch" />} /><div className="server-grid">{[0, 1].map((index) => <Panel as="article" key={index} className="server-card"><span className="guild-icon" style={{ width: 48, height: 48 }} aria-hidden="true" /><div className="server-card-copy"><h3><LoadingValue width="16ch" /></h3><p><LoadingValue width="12ch" /></p></div></Panel>)}</div></section>)}</div>;
}
