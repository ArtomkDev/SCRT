import { ActivityModuleContent } from '../module-content';
import { ActivityPageLoading } from '../loading-content';
import { MemberLink } from '../components';
import { Suspense } from 'react';
import { RowsLoading } from '@/app/components/data-loading';
import { DataBoundary } from '@/app/components/data-boundary';
import { PrefetchLink } from '@/app/components/prefetch-link';
import { activityDirectory } from '@/lib/activity-data';

async function DirectoryResults({ guildId, search, after }: { guildId: string; search: string; after?: string }) {
  const data = await activityDirectory(guildId, search, after);
  return <><ul className="activity-ranking">{data.profiles.map((profile) => <li key={profile.userId}><MemberLink guildId={guildId} userId={profile.userId} profile={profile} /></li>)}</ul>{!data.profiles.length && <p className="empty-state">Учасників зі статистикою не знайдено.</p>}{data.next && <PrefetchLink className="action-link" href={`?q=${encodeURIComponent(search)}&after=${data.next}`}>Наступні 25</PrefetchLink>}</>;
}

export default async function MembersPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const query = await searchParams;
  const search = typeof query.q === 'string' ? query.q : '';
  const after = typeof query.after === 'string' ? query.after : undefined;
  return <ActivityModuleContent guildId={guildId} fallback={<ActivityPageLoading view="members" guildId={guildId} />}><section><div className="section-intro"><div><h2>Учасники</h2><p>Учасники зі збереженою активністю. Відкрийте профіль для повідомлень, Voice, серій та застосунків. Пошук за початком імені або username.</p></div></div><form className="activity-search"><label>Пошук<input name="q" maxLength={64} defaultValue={search} /></label><button className="action-link" type="submit">Знайти</button></form><DataBoundary key={`${search}:${after ?? ''}`} title="Учасники не завантажилися"><Suspense fallback={<RowsLoading label="Завантаження учасників…" />}><DirectoryResults guildId={guildId} search={search} after={after} /></Suspense></DataBoundary></section></ActivityModuleContent>;
}
