import { ServerGroupsLoading } from './loading-content';
export default function Loading() {
  return <main className="content-page"><div className="page-heading"><h1>Сервери</h1><p>Виберіть сервер для налаштування SCRT.</p></div><ServerGroupsLoading /></main>;
}
