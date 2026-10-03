import { ActivityModuleContent } from '../../module-content';
import Image from 'next/image';
import { InlineAction } from '@/app/components/inline-action';
import { Suspense } from 'react';
import { DataLoading } from '@/app/components/data-loading';
import { activityMember, activityMemberGames, activityMemberIdentity, activityPeriod, activityProfiles, activitySettings } from '@/lib/activity-data';
import { snowflakeSchema } from '@scrt/validation';
import { formatActivityDay, type ActivityPeriod } from '@scrt/shared';
import { ActivityStats, GamesTable, number, PeriodLinks, StreakNote } from '../../components';

async function MemberIdentity({ guildId, userId }: { guildId: string; userId: string }) {
  const [identity, profiles] = await Promise.all([activityMemberIdentity(guildId, userId), activityProfiles(guildId, userId)]);
  const profile = profiles[0];
  const avatar = identity.member?.avatarUrl ?? profile?.avatarUrl;
  return <div className="section-intro"><div>{avatar && <Image src={avatar} alt="" width={48} height={48} unoptimized />}<h2>{identity.member?.nick ?? identity.member?.globalName ?? identity.member?.username ?? profile?.displayName ?? userId}</h2><p>@{identity.member?.username ?? profile?.username ?? userId}{identity.left ? ' · Користувач більше не на сервері' : ''}</p></div></div>;
}

async function MemberStats({ guildId, userId, period }: { guildId: string; userId: string; period: ActivityPeriod }) {
  const [data, settings] = await Promise.all([activityMember(guildId, userId, period), activitySettings(guildId)]);
  return <><ActivityStats data={data} /><h3 className="subheading">Voice-серії</h3><StreakNote guildId={guildId} /><dl className="voice-summary"><div><dt>Поточна серія</dt><dd>{number(data.currentVoiceStreak)} дн.</dd></div><div><dt>Найдовша серія</dt><dd>{number(data.longestVoiceStreak)} дн.</dd></div><div><dt>Остання врахована активність</dt><dd>{data.lastActivityAt ? formatActivityDay(data.lastActivityAt, settings.streak.timezone) : 'Ще немає'}</dd></div></dl></>;
}

async function MemberGames({ guildId, userId, period }: { guildId: string; userId: string; period: ActivityPeriod }) {
  return <GamesTable guildId={guildId} games={await activityMemberGames(guildId, userId, period)} period={period} member />;
}

export default async function MemberPage({ params, searchParams }: { params: Promise<{ guildId: string; userId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId, userId } = await params;
  snowflakeSchema.parse(userId);
  const period = activityPeriod((await searchParams).period);
  return <ActivityModuleContent guildId={guildId}><section><InlineAction className="activity-more" direction="back" href={'/servers/' + guildId + '/activity/members'}>Учасники</InlineAction><Suspense key={userId} fallback={<DataLoading label="Завантаження профілю учасника…" />}><MemberIdentity guildId={guildId} userId={userId} /></Suspense><PeriodLinks path={`/servers/${guildId}/activity/members/${userId}`} period={period} /><Suspense key={`${userId}:${period}`} fallback={<DataLoading label="Завантаження статистики учасника…" />}><MemberStats guildId={guildId} userId={userId} period={period} /></Suspense><section className="detail-panel"><h3>Найпопулярніші ігри та застосунки</h3><Suspense key={`${userId}:${period}`} fallback={<DataLoading label="Завантаження активностей…" />}><MemberGames guildId={guildId} userId={userId} period={period} /></Suspense></section></section></ActivityModuleContent>;
}
