import { requireGuildAccess } from '@/lib/guards';
import { initialMediaSnapshot } from '@/lib/media-data';
import { MediaFavoritesClient } from './favorites';

export default async function FavoritesPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { user } = await requireGuildAccess(guildId, 'media.view');
  const initial = await initialMediaSnapshot(guildId, user.id);
  return <MediaFavoritesClient key={`${guildId}:${user.id}`} guildId={guildId} initial={initial.snapshot} initialError={initial.unavailable} />;
}
