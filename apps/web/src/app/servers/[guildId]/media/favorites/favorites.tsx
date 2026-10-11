'use client';
import { Panel } from '@/app/components/dashboard-screen';
import { MediaControllerBoundary, useWorkspaceMediaController } from '@/app/components/media-player/media-player-context';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MediaSnapshot } from '@scrt/validation';
import { Button, Input } from '@/app/components/controls';
import { Select } from '@/app/components/select';
import { FavoriteButton, useMediaFavorites } from '../favorites-context';
import { MediaIcon } from '../media-icon';
import { MediaArtwork, mediaTime, providerNames } from '../media-track';
import { PlaylistCard, PlaylistPreview } from '../playlists';

type ViewProps = { guildId: string; initial: MediaSnapshot; initialError: string | null };
export function MediaFavoritesClient(props: ViewProps) { return <MediaControllerBoundary {...props}><MediaFavoritesClientView {...props} /></MediaControllerBoundary>; }
function MediaFavoritesClientView({ guildId, initial, initialError }: { guildId: string; initial: MediaSnapshot; initialError: string | null }) {
  const favorites = useMediaFavorites();
  const { snapshot, send, pending, message, unavailable, setMessage } = useWorkspaceMediaController(guildId, initial, initialError);
  const [liker, setLiker] = useState('all'); const [query, setQuery] = useState(''); const [visible, setVisible] = useState(50);
  const [kind, setKind] = useState<'tracks' | 'playlists'>('tracks');
  const [playlistReference, setPlaylistReference] = useState<string | null>(null);
  const enablePlaylists = favorites?.enablePlaylists;
  useEffect(() => { if (kind === 'playlists') enablePlaylists?.(); }, [kind, enablePlaylists]);
  if (!favorites) return null;
  const playlistItems = favorites.playlists?.items ?? [];
  const people = new Map((kind === 'tracks' ? favorites.items : playlistItems).flatMap((item) => item.likedBy.map((like) => [like.userId, like.name] as const)));
  const needle = query.trim().toLocaleLowerCase('uk-UA');
  const filtered = favorites.items.filter((item) =>
    (liker === 'all' || item.likedBy.some((like) => like.userId === (liker === 'me' ? favorites.userId : liker))) &&
    `${item.track.title} ${item.track.artist}`.toLocaleLowerCase('uk-UA').includes(needle)
  ).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const filteredPlaylists = playlistItems.filter((item) =>
    (liker === 'all' || item.likedBy.some((like) => like.userId === (liker === 'me' ? favorites.userId : liker))) &&
    `${item.playlist.title} ${item.playlist.artist}`.toLocaleLowerCase('uk-UA').includes(needle)
  ).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const busy = pending.length > 0;
  const can = (action: string) => Boolean(snapshot.controls[action]) && snapshot.settings.enabled && snapshot.engine.available && !unavailable && !busy;
  const duration = filtered.reduce((sum, item) => sum + (item.track.durationMs ?? 0), 0);
  function playAll() {
    if (!filtered.length) return;
    if (filtered.length > 100) { setMessage('У добірці більше 100 треків. Оберіть учасника або звузьте пошук, щоб відтворити її повністю.'); return; }
    send({ type: 'PLAY_FAVORITES', favoriteIds: filtered.map((item) => item.id) }, filtered[0]!.track);
  }
  return <section className="media-favorites" aria-label="Улюблені треки">
    <header className="media-history-header">
      <div className="media-history-heading"><span className="media-history-symbol media-favorites-symbol"><MediaIcon name="heart" width="24" height="24" /></span><div><h2>Улюблені <span className="media-count">{kind === 'tracks' ? favorites.items.length : playlistItems.length}</span></h2><p>Музика, яку обрали учасники цього сервера.</p></div></div>
      <div className="media-favorites-header-actions"><Button variant="ghost" disabled={kind === 'tracks' ? favorites.loading || favorites.pending.size > 0 : favorites.playlists.loading || favorites.playlists.pending.size > 0} onClick={() => void (kind === 'tracks' ? favorites.refresh() : favorites.playlists.refresh())}><MediaIcon name="repeat" width="16" height="16" />{(kind === 'tracks' ? favorites.loading : favorites.playlists.loading) ? 'Завантаження…' : 'Оновити'}</Button>{kind === 'tracks' && <Button disabled={favorites.loading || !filtered.length || !can('PLAY_FAVORITES')} onClick={playAll}><MediaIcon name="play" width="16" height="16" />{pending.some((job) => job.action.type === 'PLAY_FAVORITES') ? 'Запускаємо…' : `Відтворити всі · ${filtered.length}`}</Button>}</div>
    </header>
    <div className="media-source-filters" aria-label="Тип улюбленої музики"><Button variant="ghost" aria-pressed={kind === 'tracks'} onClick={() => { setKind('tracks'); setVisible(50); }}>Пісні</Button><Button variant="ghost" aria-pressed={kind === 'playlists'} onClick={() => { setKind('playlists'); setVisible(50); }}>Плейлисти</Button></div>
    <Panel as="div" className="media-favorites-toolbar">
      <label>Хто вподобав<Select searchable aria-label="Фільтр за користувачем" value={liker} onChange={(event) => { setLiker(event.target.value); setVisible(50); }}><option value="all">Усі учасники</option><option value="me">Мої сердечка</option>{[...people].filter(([id]) => id !== favorites.userId).sort((a, b) => a[1].localeCompare(b[1], 'uk')).map(([id, name]) => <option key={id} value={id}>{name}</option>)}{!['all', 'me'].includes(liker) && !people.has(liker) && <option value={liker}>Обраний учасник</option>}</Select></label>
      <label>Знайти в улюблених<div className="media-search-input"><MediaIcon name="search" width="16" height="16" /><Input type="search" aria-label="Пошук в улюблених" placeholder="Назва або виконавець…" maxLength={250} value={query} onChange={(event) => { setQuery(event.target.value); setVisible(50); }} /></div></label>
    </Panel>
    <div className="media-history-toolbar"><span>{kind === 'tracks' ? 'Треків' : 'Плейлистів'}: {kind === 'tracks' ? filtered.length : filteredPlaylists.length}{kind === 'tracks' && duration > 0 && ` · ${Math.floor(duration / 60000)} хв музики`}</span><Link href={`/servers/${guildId}/media`} className="media-history-now"><MediaIcon name="headphones" width="16" height="16" /><span>{snapshot.session?.currentTrack?.title ?? 'Перейти до плеєра'}</span></Link></div>
    {unavailable && <p className="media-feedback is-error" role="status">{unavailable} Перегляд добірки й зняття сердечок доступні.</p>}
    {!snapshot.settings.enabled && <p className="media-feedback" role="status">Модуль медіа вимкнено. Добірка залишається збереженою.</p>}
    {!unavailable && !snapshot.actorVoice.id && !snapshot.remoteControl && <p className="media-history-hint"><MediaIcon name="headphones" width="16" height="16" />Приєднайтеся до голосового каналу, щоб відтворити добірку.</p>}
    {message && <p className="media-feedback is-error" role="alert">{message}<button aria-label="Закрити повідомлення" onClick={() => setMessage('')}><MediaIcon name="remove" width="16" height="16" /></button></p>}
    {kind === 'tracks' ? <>
    <Panel as="ul" className="media-track-list media-favorites-list" aria-label="Лайкнуті пісні" aria-busy={favorites.loading}>{filtered.slice(0, visible).map(({ id, track, likedBy }) => <li key={id}>
      <button className="media-artwork-button" aria-label={`Відтворити: ${track.title}`} disabled={!can('PLAY_TRACK') || !track.playable} onClick={() => send({ type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track)}><MediaArtwork track={track} /><span className="media-artwork-overlay"><MediaIcon name="play" /></span></button>
      <div className="media-track-info"><strong title={track.title}>{track.title}</strong><span>{track.artist} · {mediaTime(track.durationMs)} · {providerNames[track.provider]}</span><small>Вподобали: {likedBy.slice(0, 3).map((like) => like.name).join(', ')}{likedBy.length > 3 && ` та ще ${likedBy.length - 3}`}</small></div>
      <div className="media-search-actions"><FavoriteButton track={track} /><Button variant="ghost" className="media-add-button" aria-label={`Додати до черги: ${track.title}`} title="Додати до черги" disabled={!can('ADD_TRACK') || !track.playable} onClick={() => send({ type: 'ADD_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track)}><MediaIcon name="plus" width="18" height="18" /><span>Додати</span></Button></div>
    </li>)}</Panel>
    {!filtered.length && <div className="media-empty"><MediaIcon name="heart" width="36" height="36" /><strong>{favorites.loading ? 'Завантажуємо добірку…' : favorites.items.length ? 'Немає треків за цим фільтром' : 'Збережіть музику, що подобається'}</strong><p>Ставте сердечка біля треків у плеєрі, пошуку або історії. Вони з’являться тут.</p></div>}
    {filtered.length > visible && <div className="media-load-more"><Button variant="secondary" onClick={() => setVisible((count) => count + 50)}>Показати ще</Button><span>{Math.min(visible, filtered.length)} із {filtered.length}</span></div>}
    {filtered.length > 0 && <p className="field-help">«Відтворити всі» запускає всю відфільтровану добірку без повторів, з урахуванням лімітів черги й треків на учасника в налаштуваннях.</p>}
    </> : <>
      <div className="media-favorite-playlists" aria-label="Улюблені плейлисти" aria-busy={favorites.playlists.loading}>{filteredPlaylists.slice(0, visible).map(({ id, playlist, likedBy }) => <PlaylistCard key={id} playlist={playlist} likes={likedBy.slice(0, 3).map((like) => like.name).join(', ') + (likedBy.length > 3 ? ` та ще ${likedBy.length - 3}` : '')} onOpen={() => { setMessage(''); setPlaylistReference(playlist.providerItemId); }} />)}</div>
      {!filteredPlaylists.length && <div className="media-empty"><MediaIcon name="queue" width="36" height="36" /><strong>{favorites.playlists.loading ? 'Завантажуємо плейлисти…' : playlistItems.length ? 'Немає плейлистів за цим фільтром' : 'Збережіть улюблений плейлист'}</strong><p>Вставте посилання SoundCloud /sets/ у пошук плеєра. Відкрийте плейлист і натисніть сердечко.</p></div>}
      {filteredPlaylists.length > visible && <div className="media-load-more"><Button variant="secondary" onClick={() => setVisible((count) => count + 50)}>Показати ще</Button><span>{Math.min(visible, filteredPlaylists.length)} із {filteredPlaylists.length}</span></div>}
    </>}
    <PlaylistPreview guildId={guildId} reference={playlistReference} onClose={() => setPlaylistReference(null)} snapshot={snapshot} send={send} busy={busy} unavailable={unavailable} message={message} />
  </section>;
}
