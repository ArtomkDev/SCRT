'use client';
import { Panel, PanelHeader } from '@/app/components/dashboard-screen';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MediaSnapshot } from '@scrt/validation';
import { type MediaTrack, type MediaQueueItem } from '@scrt/shared';
import { Button, Input } from '@/app/components/controls';
import { ModuleDisabledState } from '@/app/components/module-status';
import { MediaIcon } from './media-icon';
import { MediaControllerBoundary, useHasWorkspaceMediaController, useWorkspaceMediaController } from '@/app/components/media-player/media-player-context';
import { MediaPlaybackPanel } from './player-panel';
import { usePlayerSearch } from './player-search';
import { FavoriteButton } from './favorites-context';
import { PlaylistCard, PlaylistPreview } from './playlists';
import { MediaArtwork, mediaTime, providerNames } from './media-track';
import { usePlayerShortcuts } from './player-shortcuts';
function sameTrack(a: MediaTrack | null, b: MediaTrack) { return a?.provider === b.provider && a.providerItemId === b.providerItemId; }

type PlayerProps = { guildId: string; userId: string; initial: MediaSnapshot; initialError: string | null; allowYoutube?: boolean };
export function MediaPlayerClient(props: PlayerProps) {
  return <MediaControllerBoundary {...props}><MediaLibrary {...props} /></MediaControllerBoundary>;
}
function MediaLibrary({ guildId, userId, initial, initialError, allowYoutube = true }: PlayerProps) {
  const workspace = useHasWorkspaceMediaController();
  const { snapshot, unavailable, message, transient, setMessage, send, pending } = useWorkspaceMediaController(guildId, initial, initialError);
  const { session, settings, controls } = snapshot;
  const youtubeSearch = allowYoutube && !snapshot.providers.some((provider) => provider.id === 'youtube' && !provider.capabilities.search);
  const { query, setQuery, results, playlists, searchPending, searchingQuery, searched, matchedQuery, source, setSource, mobileTab, setMobileTab, nextPage, search } = usePlayerSearch(guildId, userId, snapshot.providers, setMessage, youtubeSearch);
  const [playlistReference, setPlaylistReference] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState('');
  const searchForm = useRef<HTMLFormElement>(null);
  useEffect(() => { setQueueFilter(''); }, [guildId, userId]);
  const loadingTrack = pending.filter((job) => job.action.type === 'PLAY_TRACK').at(-1)?.track ?? null;
  const paused = session?.state === 'paused'; const enabled = settings.enabled;
  const can = (type: string) => Boolean(controls[type]) && !unavailable && enabled;
  const pendingTrack = (item: MediaTrack) => pending.some((job) => (job.action.type === 'ADD_TRACK' || job.action.type === 'PLAY_TRACK') && job.action.provider === item.provider && job.action.providerItemId === item.providerItemId);
  const pendingAdds = pending.filter((job) => job.action.type === 'ADD_TRACK' && job.track);
  const queueCount = (session?.queue.length ?? 0) + pendingAdds.length;
  const differentVoice = Boolean(session && snapshot.actorVoice.id !== session.voiceChannelId && (session.currentTrack || session.recoverable));
  const restoreHere = differentVoice && snapshot.canManage && snapshot.actorVoice.id;
  const filtered = results.filter((item) => (youtubeSearch || item.provider !== 'youtube') && (source === 'all' || source === 'playable' && item.playable || item.provider === source));
  const visiblePlaylists = playlists.filter((item) => source === 'all' || source === 'soundcloud' || source === 'playable' && item.trackCount > 0);
  const queueDuration = session?.queue.reduce((total, item) => total + (item.durationMs ?? 0), 0) ?? 0;
  const queueTime = queueDuration >= 3600000 ? `${Math.floor(queueDuration / 3600000)} год ${Math.floor(queueDuration % 3600000 / 60000)} хв` : mediaTime(queueDuration);
  const queueQuery = queueFilter.trim().toLocaleLowerCase();
  const matchesQueue = (item: MediaQueueItem) => `${item.title} ${item.artist} ${item.requestedByName}`.toLocaleLowerCase().includes(queueQuery);
  // Keep original positions when filtering; backend reordering still addresses the full queue.
  const upcoming = (session?.queue ?? []).map((item, index) => ({ item, index })).filter(({ item }) => matchesQueue(item));
  const played = [...(session?.played ?? [])].reverse().filter(matchesQueue);

  function focusSearch() {
    setMobileTab('search');
    requestAnimationFrame(() => { const input = searchForm.current?.querySelector<HTMLInputElement>('input[type="search"]'); input?.focus(); input?.select(); });
  }
  usePlayerShortcuts({ canToggle: false, canSeek: false, blocked: Boolean(playlistReference), onToggle: () => {}, onSeek: () => {}, onSearch: focusSearch });

  function play(item: MediaTrack, fromSearch = false) {
    if (!loadingTrack && sameTrack(session?.currentTrack ?? null, item)) send({ type: paused ? 'RESUME' : 'PAUSE' });
    else {
      const following = fromSearch ? filtered.slice(filtered.indexOf(item) + 1).filter((entry) => entry.playable).slice(0, 99).map(({ provider, providerItemId }) => ({ provider, providerItemId })) : [];
      send({ type: 'PLAY_TRACK', provider: item.provider, providerItemId: item.providerItemId, ...(following.length ? { following } : {}) }, item);
    }
  }
  function move(queueItemId: string, position: number) {
    if (session) send({ type: 'MOVE_QUEUE_ITEM', queueItemId, position, expectedQueueVersion: session.queueVersion });
  }
  function retainedRow(item: MediaQueueItem, current = false) {
    return <li key={item.queueItemId} className={current ? 'is-current' : 'media-played-row'}>
      <span className="media-queue-position"><MediaIcon name={current ? paused ? 'pause' : 'volume' : 'repeat'} width="14" height="14" /></span>
      <button className="media-artwork-button" aria-label={`${current && !loadingTrack ? paused ? 'Відновити' : 'Призупинити' : 'Повторити'}: ${item.title}`} disabled={!can(current && !loadingTrack ? paused ? 'RESUME' : 'PAUSE' : 'PLAY_TRACK') || !snapshot.engine.available} onClick={() => play(item)}><MediaArtwork track={item} /><span className="media-artwork-overlay"><MediaIcon name={current && !loadingTrack && !paused ? 'pause' : 'play'} /></span></button>
      <div className="media-track-info"><strong title={item.title}>{item.title}</strong><span>{item.artist} · {mediaTime(item.durationMs)}</span><small>{current ? paused ? 'На паузі' : 'Зараз грає' : 'Зіграно · натисни ▶, щоб повторити'}</small></div>
      <div className="media-row-actions"><FavoriteButton track={item} />{!current && <Button variant="icon" aria-label={`Видалити: ${item.title}`} title="Прибрати зі зіграних" disabled={!snapshot.queueControls[item.queueItemId]?.remove || Boolean(unavailable)} onClick={() => session && send({ type: 'REMOVE_QUEUE_ITEM', queueItemId: item.queueItemId, expectedQueueVersion: session.queueVersion })}><MediaIcon name="remove" width="16" height="16" /></Button>}</div>
    </li>;
  }
  return <div className="media-player media-library">
    {snapshot.remoteControl && <div className="media-status-line"><span className="media-badge">Віддалене керування</span></div>}
    {!enabled && <ModuleDisabledState title="Модуль вимкнено." description="Увімкніть Медіа, щоб слухати музику у Voice."><Link className="ui-button ui-button-secondary" href={`/servers/${guildId}/media/settings`}>Налаштування модуля</Link></ModuleDisabledState>}
    {unavailable && <p className="media-feedback is-error" role="alert">{unavailable}</p>}
    {enabled && !snapshot.engine.available && !unavailable && <p className="media-feedback is-error">Аудіодвигун недоступний. Перевірте <Link href={`/servers/${guildId}/media/diagnostics`}>діагностику</Link>.</p>}
    {differentVoice && <div className="media-voice-notice"><MediaIcon name="headphones" /><div><p>{session?.recoverable ? 'Збережена черга була в ' : 'SCRT відтворює музику в '}<strong>{session!.voiceChannelName}</strong>. {snapshot.actorVoice.name && `Ви перебуваєте в ${snapshot.actorVoice.name}.`}</p>{restoreHere ? <p>Натисніть «Відновити тут», щоб запустити збережену чергу у {snapshot.actorVoice.name}.</p> : session?.recoverable ? <p>Адміністратор Медіа може відновити чергу у вашому Voice.</p> : !snapshot.remoteControl && <p>Приєднайтеся до {session!.voiceChannelName}, щоб керувати плеєром.</p>}</div></div>}
    {message && <p className={`media-feedback${transient ? ' media-toast' : ''}`} role="status" aria-live="polite">{message}<button aria-label="Закрити повідомлення" onClick={() => setMessage('')}><MediaIcon name="remove" width="16" height="16" /></button></p>}
    <div className="media-workspace">
    {!workspace && <MediaPlaybackPanel guildId={guildId} initial={initial} initialError={initialError} showFeedback={false} />}
    <div className="media-mobile-tabs"><Button variant="secondary" aria-pressed={mobileTab === 'search'} onClick={() => setMobileTab('search')}>Пошук</Button><Button variant="secondary" aria-pressed={mobileTab === 'queue'} onClick={() => setMobileTab('queue')}>Черга · {queueCount}</Button></div>
    <div className="media-columns" data-mobile-tab={mobileTab}>
      <Panel className="media-search" aria-label="Пошук музики"><PanelHeader className="media-section-heading" title="Знайти музику" description="Назва, виконавець або посилання на трек чи плейлист SoundCloud" actions={<MediaIcon name="search" />} />
        <form className="media-search-form" ref={searchForm} onSubmit={(event) => { event.preventDefault(); void search(); }}><div className="media-search-input"><MediaIcon name="search" /><Input type="search" value={query} aria-label="Пошук треку, виконавця або URL" placeholder="Що хочеш послухати?" minLength={2} maxLength={250} onChange={(event) => setQuery(event.target.value)} /></div><Button type="submit" disabled={searchPending && query.trim() === searchingQuery || query.trim().length < 2 || Boolean(unavailable)}>{searchPending && query.trim() === searchingQuery ? 'Пошук…' : 'Знайти'}</Button></form>
        <div className="media-source-filters" aria-label="Джерела пошуку"><Button variant="ghost" aria-pressed={source === 'all'} onClick={() => setSource('all')}>Усі</Button><Button variant="ghost" aria-pressed={source === 'playable'} onClick={() => setSource('playable')}>Для відтворення</Button>{snapshot.providers.filter((provider) => provider.state !== 'unconfigured' && provider.capabilities.search && (youtubeSearch || provider.id !== 'youtube')).map((provider) => <Button key={provider.id} variant="ghost" aria-pressed={source === provider.id} onClick={() => setSource(provider.id)}>{providerNames[provider.id]}</Button>)}</div>
        {searched && <div className="media-search-summary" role="status"><span>Знайдено: {filtered.length + visiblePlaylists.length}</span>{matchedQuery && <span>Також шукали «{matchedQuery}»</span>}</div>}
        {visiblePlaylists.map((playlist) => <PlaylistCard key={playlist.providerItemId} playlist={playlist} onOpen={() => { setMessage(''); setPlaylistReference(playlist.providerItemId); }} />)}
        <ul className="media-track-list media-search-results" aria-label="Результати пошуку" aria-busy={searchPending}>{filtered.map((item) => {
          const current = sameTrack(session?.currentTrack ?? null, item); const allowed = current && !loadingTrack ? can(paused ? 'RESUME' : 'PAUSE') : can('PLAY_TRACK');
          return <li key={`${item.provider}:${item.providerItemId}`} className={current ? 'is-current' : ''}>
            {item.playable ? <button className="media-artwork-button" aria-label={`${current && !loadingTrack ? paused ? 'Відновити' : 'Призупинити' : 'Відтворити'}: ${item.title}`} title={allowed ? 'Відтворити звідси й продовжити добірку' : 'Перемикання треків потребує дозволу DJ або адміністратора.'} disabled={!allowed || !snapshot.engine.available} onClick={() => play(item, true)}><MediaArtwork track={item} /><span className="media-artwork-overlay"><MediaIcon name={current && !loadingTrack && !paused ? 'pause' : 'play'} /></span></button> : <MediaArtwork track={item} />}
            <div className="media-track-info"><strong title={item.title}>{item.title}</strong><span>{item.artist}</span><small>{providerNames[item.provider]} · {item.type === 'live' ? 'LIVE' : mediaTime(item.durationMs)}{!item.playable && ' · Лише інформація'}{item.explicit === true && ' · Explicit'}</small></div>
            <div className="media-search-actions"><FavoriteButton track={item} />{item.playable ? <Button className="media-add-button" variant="ghost" aria-label={`Додати до черги: ${item.title}`} disabled={!can('ADD_TRACK') || !snapshot.engine.available || pendingTrack(item)} title="Додати в кінець черги" onClick={() => send({ type: 'ADD_TRACK', provider: item.provider, providerItemId: item.providerItemId }, item)}><MediaIcon name="plus" /><span>{pending.some((job) => job.action.type === 'PLAY_TRACK' && job.track && sameTrack(job.track, item)) ? 'Запускається…' : pendingTrack(item) ? 'Додається…' : 'Додати'}</span></Button> : <a className="ui-button ui-button-ghost" href={item.externalUrl} target="_blank" rel="noopener noreferrer">Відкрити у {item.provider}</a>}</div>
          </li>;
        })}</ul>
        {nextPage !== null && <div className="media-load-more"><Button variant="secondary" disabled={searchPending || Boolean(unavailable)} onClick={() => void search(true)}>{searchPending ? 'Завантаження…' : 'Завантажити ще'}</Button><span>Завантажено: {results.length}</span></div>}
        {!filtered.length && !visiblePlaylists.length && <div className="media-empty"><MediaIcon name="search" width="32" height="32" /><strong>{searchPending ? 'Шукаємо музику…' : searched ? 'Спробуй інший запит' : 'Музика починається з пошуку'}</strong><p>{youtubeSearch ? 'Встав посилання YouTube, YouTube Music, SoundCloud чи аудіофайлу або знайди трек за назвою.' : 'Знайди музику в SoundCloud за назвою або встав посилання SoundCloud чи аудіофайлу.'}</p></div>}
      </Panel>
      <Panel className="media-queue" aria-label="Черга відтворення"><PanelHeader className="media-section-heading" title={<>Черга <span className="media-count">{queueCount}</span></>} description={<>{queueDuration ? `${session?.queue.some((item) => item.durationMs === null) ? 'Від ' : ''}${queueTime} музики попереду · ` : ''}{session?.queueMode === 'fair' ? 'Справедлива черга' : 'Зіграні треки залишаються для повтору'}</>} actions={<MediaIcon name="queue" />} />
        {Boolean(session?.queue.length || session?.played.length) && <div className="media-queue-filter"><MediaIcon name="search" width="16" height="16" /><Input type="text" aria-label="Фільтр черги та зіграних треків" placeholder="Знайти в черзі…" maxLength={100} value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)} />{queueFilter && <Button variant="ghost" aria-label="Очистити фільтр черги" onClick={() => setQueueFilter('')}><MediaIcon name="remove" width="14" height="14" /></Button>}</div>}
        <div className="media-queue-content" tabIndex={0} aria-label="Список треків у черзі">
        {session?.currentTrack && <ul className="media-track-list media-queue-list" aria-label="Поточний трек">{retainedRow(session.currentTrack, true)}</ul>}
        {Boolean(session?.queue.length || pendingAdds.length) && <h3 className="media-queue-group">Далі · {upcoming.length + pendingAdds.length}{queueQuery && ` із ${queueCount}`}</h3>}
        {upcoming.length || pendingAdds.length ? <ol className="media-track-list media-queue-list" aria-label="Наступні треки">{upcoming.map(({ item, index }) => {
          const allowed = snapshot.queueControls[item.queueItemId];
          return <li key={item.queueItemId} className={dragging === item.queueItemId ? 'is-dragging' : ''} draggable={Boolean(allowed?.move) && !unavailable && !queueQuery} onDragStart={(event) => { setDragging(item.queueItemId); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.queueItemId); }} onDragEnd={() => setDragging(null)} onDragOver={(event) => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); if (dragging && dragging !== item.queueItemId && snapshot.queueControls[dragging]?.move) move(dragging, index); setDragging(null); }}>
            <span className="media-queue-position">{index + 1}</span><button className="media-artwork-button" aria-label={`Відтворити з черги: ${item.title}`} disabled={!can('PLAY_TRACK') || !snapshot.engine.available} onClick={() => play(item)}><MediaArtwork track={item} /><span className="media-artwork-overlay"><MediaIcon name="play" /></span></button>
            <div className="media-track-info"><strong title={item.title}>{item.title}</strong><span>{item.artist} · {mediaTime(item.durationMs)}</span><small>Додав {item.requestedByName}</small></div>
            <div className="media-row-actions"><FavoriteButton track={item} /><Button variant="icon" title="Перемістити вище" aria-label={`Перемістити вище: ${item.title}`} disabled={index === 0 || !allowed?.move || Boolean(unavailable)} onClick={() => move(item.queueItemId, index - 1)}><MediaIcon name="up" width="16" height="16" /></Button><Button variant="icon" title="Перемістити нижче" aria-label={`Перемістити нижче: ${item.title}`} disabled={index === (session?.queue.length ?? 0) - 1 || !allowed?.move || Boolean(unavailable)} onClick={() => move(item.queueItemId, index + 1)}><MediaIcon name="down" width="16" height="16" /></Button><Button variant="icon" title="Видалити з черги" aria-label={`Видалити: ${item.title}`} disabled={!allowed?.remove || Boolean(unavailable)} onClick={() => session && send({ type: 'REMOVE_QUEUE_ITEM', queueItemId: item.queueItemId, expectedQueueVersion: session.queueVersion })}><MediaIcon name="remove" width="16" height="16" /></Button></div>
          </li>;
        })}{pendingAdds.map((job) => <li className="media-pending-row" key={job.id}><span className="media-queue-position">…</span><MediaArtwork track={job.track!} /><div className="media-track-info"><strong>{job.track!.title}</strong><small>Додається до черги…</small></div></li>)}</ol> : !session?.played.length && !session?.currentTrack && <div className="media-empty"><MediaIcon name="queue" width="36" height="36" /><strong>Тут буде твоя добірка</strong><p>Натисни ▶ у пошуку, щоб слухати звідти й далі. Кнопка + додає лише вибраний трек у чергу.</p></div>}
        {queueQuery && !upcoming.length && !played.length && <p className="media-filter-empty" role="status">Немає збігів у черзі та зіграних треках.</p>}
        {Boolean(session?.queue.length) && <p className="media-queue-help">{queueQuery ? 'Стрілки змінюють позицію в повній черзі.' : 'Перетягни трек або скористайся стрілками, щоб змінити порядок.'}</p>}
        {Boolean(session?.played.length) && <details className="media-played-details"><summary><MediaIcon name="history" width="16" height="16" /><span>Зіграні</span><span className="media-count">{played.length}</span><MediaIcon name="down" width="14" height="14" /></summary><ul className="media-track-list media-queue-list" aria-label="Зіграні треки">{played.map((item) => retainedRow(item))}</ul></details>}
        </div>
      </Panel>
    </div>
    </div>
    <PlaylistPreview guildId={guildId} reference={playlistReference} onClose={() => setPlaylistReference(null)} snapshot={snapshot} send={send} busy={pending.length > 0} unavailable={unavailable} message={message} />
  </div>;
}
