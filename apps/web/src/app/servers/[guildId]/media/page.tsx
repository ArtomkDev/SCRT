import { requireGuildAccess } from '@/lib/guards';
import { initialMediaSnapshot } from '@/lib/media-data';
import { MediaPlayerClient } from './player';
export default async function MediaPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params; const { user } = await requireGuildAccess(guildId, 'media.view');
  const initial = await initialMediaSnapshot(guildId, user.id);
  return <MediaPlayerClient key={`${guildId}:${user.id}`} guildId={guildId} userId={user.id} initial={initial.snapshot} initialError={initial.unavailable} />;
}
