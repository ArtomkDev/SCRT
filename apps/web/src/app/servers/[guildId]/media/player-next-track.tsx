import type { MediaSession } from '@scrt/shared';
import { MediaArtwork, mediaTime } from './media-track';
import { MediaIcon } from './media-icon';

export function PlayerNextTrack({ session, loading }: { session: MediaSession | null; loading: boolean }) {
  if (!session?.currentTrack || loading) return null;
  const repeating = session.repeatMode === 'track' || session.repeatMode === 'queue' && session.queue.length === 0;
  const next = repeating ? session.currentTrack : session.queue[0];
  return <aside className="media-next-up" aria-label="Наступний трек">
    <div className="media-next-label"><MediaIcon name={repeating ? 'repeat' : 'next'} width="14" height="14" />{repeating ? 'На повторі' : 'Далі у черзі'}</div>
    {next ? <div className="media-next-track"><MediaArtwork track={next} /><div className="media-track-info"><strong title={next.title}>{next.title}</strong><span>{next.artist}</span><small>{next.type === 'live' ? 'LIVE' : mediaTime(next.durationMs)} · {repeating ? 'Повторне відтворення' : `Додав ${next.requestedByName}`}</small></div></div>
      : <p className="media-next-empty">Черга вільна. Додай наступний трек із пошуку.</p>}
  </aside>;
}
