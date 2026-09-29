import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireGuildAccess } from '@/lib/guards';

export default async function GuildHome({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { permissions } = await requireGuildAccess(guildId);
  if (permissions.has('voice.view')) redirect(`/servers/${guildId}/voice`);
  if (permissions.has('settings.view')) redirect(`/servers/${guildId}/settings/access-control`);
  return <main className="content-page"><div className="page-heading"><h1>Немає доступних модулів</h1><p>Для вашої ролі на цьому сервері поки немає доступних налаштувань SCRT.</p></div><Link href="/servers" className="primary-link">До списку серверів</Link></main>;
}
