import { unstable_rethrow } from 'next/navigation';
import { manageableGuildList } from '@/lib/guards';
import { groupGuilds } from '@/lib/guild-presentation';
import { GuildNavigation } from './guild-navigation';

export async function GuildNavigationData({ development }: { development: boolean }) {
  try {
    const { list, installedIds } = await manageableGuildList();
    return <GuildNavigation groups={groupGuilds(list, installedIds)} development={development} />;
  } catch (error) {
    unstable_rethrow(error);
    console.error('Dashboard guild navigation could not load.');
    return <GuildNavigation groups={{ installed: [], available: [] }} development={development} unavailable />;
  }
}
