import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireGuildAccess } from '@/lib/guards';
import { activityGame, activityMemberIdentity, activityProfiles } from '@/lib/activity-data';
import { guildScreenSearch, parseGuildScreen } from '@/lib/guild-screen';

export default async function GuildHome({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const { permissions } = await requireGuildAccess(guildId);
  const query = await searchParams ?? {};
  const screen = parseGuildScreen(query.screen);
  if (screen && permissions.has(screen.permission)) {
    let path = screen.path;
    if (screen.gameKey && !await activityGame(guildId, screen.gameKey, 'all')) path = 'activity/games';
    if (screen.userId) {
      const profiles = await activityProfiles(guildId, screen.userId);
      if (!profiles.some((profile) => profile.userId === screen.userId) && !(await activityMemberIdentity(guildId, screen.userId)).member) path = 'activity/members';
    }
    const search = guildScreenSearch(path, { get: (key) => typeof query[key] === 'string' ? query[key] : null });
    redirect(`/servers/${guildId}/${path}${search.size ? '?' + search : ''}`);
  }
  if (permissions.has('activity.view')) redirect(`/servers/${guildId}/activity`);
  if (permissions.has('voice.view')) redirect(`/servers/${guildId}/voice`);
  if (permissions.has('settings.view')) redirect(`/servers/${guildId}/settings/access-control`);
  return <main className="content-page"><div className="page-heading"><h1>Немає доступних модулів</h1><p>У вас немає доступу до розділів панелі. Зверніться до адміністратора сервера.</p></div><Link href="/servers" className="primary-link">До списку серверів</Link></main>;
}
