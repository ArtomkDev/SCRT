import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireGuildAccess } from '@/lib/guards';

export default async function GuildHome({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { permissions } = await requireGuildAccess(guildId);
  if (permissions.has('voice.view')) redirect(`/servers/${guildId}/voice`);
  if (permissions.has('activity.view')) redirect(`/servers/${guildId}/activity`);
  if (permissions.has('settings.view')) redirect(`/servers/${guildId}/settings/access-control`);
  return <main className="content-page"><div className="page-heading"><h1>Немає доступних модулів</h1><p>У вас немає доступу до розділів панелі. Зверніться до адміністратора сервера.</p></div><Link href="/servers" className="primary-link">До списку серверів</Link></main>;
}
