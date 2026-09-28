import Link from 'next/link';
import { DashboardShell } from '../components/dashboard-shell';

export default function Dashboard() {
  return <DashboardShell><main className="content-page"><div className="page-heading"><h1>Огляд</h1><p>Оберіть сервер, щоб керувати SCRT.</p></div><Link href="/servers" className="primary-link">Переглянути сервери</Link></main></DashboardShell>;
}
