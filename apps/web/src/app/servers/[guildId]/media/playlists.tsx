'use client';
import { Panel } from '@/app/components/dashboard-screen';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MediaPlaylist, MediaTrack } from '@scrt/shared';
import { mediaPlaylistPageSchema, type MediaAction, type MediaPlaylistPage, type MediaSnapshot } from '@scrt/validation';
import { Button, Input } from '@/app/components/controls';
import { Dialog } from '@/app/components/dialog';
import { FavoriteButton, PlaylistFavoriteButton } from './favorites-context';
import { MediaIcon } from './media-icon';
import { MediaArtwork, mediaTime } from './media-track';
import { mediaResponse } from './player-controller';

export function PlaylistCard({ playlist, onOpen, likes }: { playlist: MediaPlaylist; onOpen: () => void; likes?: string }) {
  return <Panel as="article" className="media-playlist-card">
    <button className="media-playlist-open" onClick={onOpen} aria-label={`Відкрити плейлист: ${playlist.title}`}>
      <span className="media-playlist-cover"><MediaArtwork track={playlist} /><span><MediaIcon name="queue" width="14" height="14" /></span></span>
      <span className="media-track-info"><small>Плейлист · SoundCloud</small><strong>{playlist.title}</strong><span>{playlist.artist} · {playlist.trackCount} треків</span>{likes && <small>Вподобали: {likes}</small>}</span>
    </button>
    <div className="media-playlist-card-actions"><PlaylistFavoriteButton playlist={playlist} /><Button variant="secondary" onClick={onOpen}>Відкрити</Button></div>
  </Panel>;
}
type PreviewProps = {
  guildId: string; reference: string | null; onClose: () => void; snapshot: MediaSnapshot;
  send: (action: MediaAction, track?: MediaTrack) => void; busy: boolean; unavailable: string | null; message: string;
};
export function PlaylistPreview(props: PreviewProps) {
  return <Dialog open={Boolean(props.reference)} onClose={props.onClose} title="Плейлист SoundCloud" className="media-playlist-dialog">
    {props.reference && <PlaylistContents key={`${props.guildId}:${props.reference}`} {...props} reference={props.reference} />}
  </Dialog>;
}
function PlaylistContents({ guildId, reference, snapshot, send, busy, unavailable, message }: PreviewProps & { reference: string }) {
  const [page, setPage] = useState<MediaPlaylistPage | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [filter, setFilter] = useState('');
  const request = useRef<AbortController | null>(null);
  async function load(more = false) {
    if (more && (request.current || page?.nextPage == null)) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ playlist: reference, page: String(more ? page!.nextPage : 0) });
      const value = mediaPlaylistPageSchema.parse(await mediaResponse(await fetch(`/api/guilds/${guildId}/media?${params}`, { cache: 'no-store', signal: controller.signal })));
      if (value.playlist.providerItemId !== reference || value.page !== (more ? page!.nextPage : 0)) throw new Error('Джерело повернуло інший плейлист.');
      if (more && page && (page.playlist.trackCount !== value.playlist.trackCount || value.nextPage !== null && value.nextPage <= value.page)) throw new Error('Плейлист змінився. Відкрийте його знову.');
      if (!controller.signal.aborted) setPage((previous) => {
        if (!more || !previous) return value;
        return { ...value, entries: [...previous.entries, ...value.entries], unavailableCount: previous.unavailableCount + value.unavailableCount };
      });
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не вдалося відкрити плейлист.'); }
    finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = null; }; }, [guildId, reference]); // load only when this set is opened
  const can = (action: string) => Boolean(snapshot.controls[action]) && snapshot.settings.enabled && snapshot.engine.available && !unavailable && !busy;
  const needle = filter.trim().toLocaleLowerCase('uk-UA');
  const entries = page?.entries.filter(({ track }) => `${track.title} ${track.artist}`.toLocaleLowerCase('uk-UA').includes(needle)) ?? [];
  const limit = Math.min(snapshot.settings.maxQueueItems, snapshot.settings.maxTracksPerUser);
  function play(shuffle: boolean) { if (page) send({ type: 'PLAY_PLAYLIST', providerItemId: reference, shuffle }); }
  return <div className="media-playlist-preview" aria-busy={loading}>
    {page && <>
      <header className="media-playlist-heading"><MediaArtwork track={page.playlist} /><div><small>Плейлист · {page.playlist.trackCount} треків</small><h3>{page.playlist.title}</h3><p>{page.playlist.artist}</p><a href={page.playlist.externalUrl} target="_blank" rel="noreferrer">Відкрити у SoundCloud <MediaIcon name="external" width="13" height="13" /></a></div><PlaylistFavoriteButton playlist={page.playlist} /></header>
      <div className="media-playlist-controls"><Button disabled={!can('PLAY_PLAYLIST') || !page.playlist.trackCount || page.playlist.trackCount > limit} onClick={() => play(false)}><MediaIcon name="play" width="16" height="16" />{busy ? 'Виконуємо…' : 'Відтворити по порядку'}</Button><Button variant="secondary" disabled={!can('PLAY_PLAYLIST') || !page.playlist.trackCount || page.playlist.trackCount > limit} onClick={() => play(true)}><MediaIcon name="shuffle" width="16" height="16" />Перемішати й відтворити</Button></div>
      <p className="field-help">Запуск плейлиста замінює поточну чергу. Натисніть ▶ біля пісні, щоб увімкнути тільки її; + додає її до черги.</p>
      {page.playlist.trackCount > limit && <p className="media-feedback" role="status">Для всього плейлиста потрібно збільшити ліміти черги та треків на учасника в налаштуваннях. Поточний ліміт — {limit}; окремі пісні доступні. {snapshot.canManage && <Link href={`/servers/${guildId}/media/settings`}>Відкрити налаштування</Link>}</p>}
      {!snapshot.actorVoice.id && !snapshot.remoteControl && <p className="media-history-hint"><MediaIcon name="headphones" width="16" height="16" />Для відтворення приєднайтеся до голосового каналу.</p>}
      <div className="media-search-input"><MediaIcon name="search" width="16" height="16" /><Input type="search" aria-label="Знайти пісню в плейлисті" placeholder="Знайти в завантажених треках…" value={filter} onChange={(event) => setFilter(event.target.value)} maxLength={250} /></div>
      <ol className="media-track-list media-playlist-tracks" aria-label="Пісні плейлиста">{entries.map(({ position, track }) => {
        const current = snapshot.session?.currentTrack?.provider === track.provider && snapshot.session.currentTrack.providerItemId === track.providerItemId;
        return <li key={position} className={current ? 'is-current' : ''}><span className="media-queue-position">{position}</span>
          <button className="media-artwork-button" aria-label={`Відтворити окремо: ${track.title}`} disabled={!can('PLAY_TRACK') || !track.playable} onClick={() => send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track)}><MediaArtwork track={track} /><span className="media-artwork-overlay"><MediaIcon name="play" /></span></button>
          <div className="media-track-info"><strong title={track.title}>{track.title}</strong><span>{track.artist} · {mediaTime(track.durationMs)}</span><small>{current ? 'Зараз грає' : !track.playable ? 'Недоступний для повного відтворення' : ''}</small></div>
          <div className="media-search-actions"><FavoriteButton track={track} /><Button variant="icon" title="Додати до черги" aria-label={`Додати до черги: ${track.title}`} disabled={!can('ADD_TRACK') || !track.playable} onClick={() => send({ type: 'ADD_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track)}><MediaIcon name="plus" /></Button></div>
        </li>;
      })}</ol>
      {!entries.length && <div className="media-empty"><MediaIcon name="queue" /><strong>{filter ? 'Немає збігів у завантажених треках' : 'У плейлисті немає доступних треків'}</strong></div>}
      {page.unavailableCount > 0 && <p className="field-help">SoundCloud не надав інформацію про {page.unavailableCount} треків. Їх пропущено.</p>}
      {page.nextPage !== null && <div className="media-load-more"><Button variant="secondary" disabled={loading} onClick={() => void load(true)}>{loading ? 'Завантаження…' : 'Показати ще треки'}</Button><span>{page.entries.length + page.unavailableCount} із {page.playlist.trackCount}</span></div>}
    </>}
    {!page && loading && <div className="media-empty" role="status"><MediaIcon name="queue" width="36" height="36" /><strong>Завантажуємо плейлист…</strong><p>Перегляд не запускає музику.</p></div>}
    {error && <p className="media-feedback is-error" role="alert">{error}<Button variant="ghost" disabled={loading} onClick={() => void load(Boolean(page))}>Спробувати ще раз</Button></p>}
    {message && <p className="media-feedback is-error" role="status">{message}</p>}
  </div>;
}
