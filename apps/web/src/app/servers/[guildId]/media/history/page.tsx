import { z } from 'zod';
import { requireGuildAccess } from '@/lib/guards';
import { media } from '@/lib/server';
import { initialMediaSnapshot } from '@/lib/media-data';
import { MediaHistoryClient } from './history';
export default async function MediaHistoryPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ before?: string; beforeId?: string }> }) {
  const { guildId } = await params; const { user } = await requireGuildAccess(guildId, 'media.view'); const search = await searchParams;
  const cursor = z.coerce.number().int().positive().safeParse(search.before); const id = z.uuid().safeParse(search.beforeId);
  const [history, initial] = await Promise.all([
    media().history(guildId, cursor.success ? cursor.data : Date.now(), 25, id.success ? id.data : undefined),
    initialMediaSnapshot(guildId, user.id),
  ]);
  return <MediaHistoryClient key={`${guildId}:${user.id}`} guildId={guildId} userId={user.id} history={history} initial={initial.snapshot} initialError={initial.unavailable} />;
}
