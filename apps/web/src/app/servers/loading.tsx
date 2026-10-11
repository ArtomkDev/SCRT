import { ServerGroupsLoading } from './loading-content';
import { DashboardScreen, ScreenHeader } from '../components/dashboard-screen';
export default function Loading() {
  return <DashboardScreen header={<ScreenHeader title="Сервери" description="Виберіть сервер для налаштування SCRT." />}><ServerGroupsLoading /></DashboardScreen>;
}
