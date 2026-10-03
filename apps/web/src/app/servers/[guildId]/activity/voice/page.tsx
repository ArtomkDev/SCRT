import { ActivityModuleContent } from '../module-content';
import { ActivityPageLoading, VoiceRunNoteLoading } from '../loading-content';
import { Suspense } from 'react';
import { activityPeriod } from '@/lib/activity-data';
import { ActivitySummary, PeriodLinks, Ranking, StreakNote, VoiceRunNote } from '../components';

export default async function VoiceActivityPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { guildId } = await params;
  const period = activityPeriod((await searchParams).period);
  return <ActivityModuleContent guildId={guildId} fallback={<ActivityPageLoading view="voice" guildId={guildId} period={period} />}><section><div className="section-intro"><div><h2>Voice</h2><p>Час у дозволених каналах, зокрема з mute/deafen. Час демонстрації екрана входить також у час Voice.</p></div></div><PeriodLinks path={'/servers/' + guildId + '/activity/voice'} period={period} /><ActivitySummary guildId={guildId} period={period} domain="voice" /><div className="voice-columns"><Ranking guildId={guildId} metric="voiceSeconds" period={period} title="Топ Voice" /><Ranking guildId={guildId} metric="streamSeconds" period={period} title="Топ демонстрації екрана" /></div><Suspense fallback={<VoiceRunNoteLoading />}><VoiceRunNote guildId={guildId} /></Suspense><Ranking guildId={guildId} metric="longestVoiceRunSeconds" period="all" title="Топ безперервного Voice" /><h2 className="subheading">Voice-серії</h2><Suspense fallback={null}><StreakNote guildId={guildId} /></Suspense><div className="voice-columns"><Ranking guildId={guildId} metric="currentVoiceStreak" period="all" title="Поточні серії" /><Ranking guildId={guildId} metric="longestVoiceStreak" period="all" title="Найдовші серії" /></div></section></ActivityModuleContent>;
}
