'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { MediaSnapshot } from '@scrt/validation';
import { mediaProgress, type MediaTrack, type MediaQueueItem } from '@scrt/shared';
import { Button, Input } from '@/app/components/controls';
import { Select } from '@/app/components/select';
import { Dialog } from '@/app/components/dialog';
import { ModuleDisabledState, ModuleStatus } from '@/app/components/module-status';
import { MediaIcon } from './media-icon';
import { useMediaController } from './player-controller';
import { usePlayerSearch } from './player-search';
import { cachedArtworkAccent, MediaCover } from './player-artwork';
import { MediaArtwork, mediaTime, providerNames } from './media-track';
import { PlayerProgress } from './player-progress';
import { PlayerNextTrack } from './player-next-track';
import { usePlayerShortcuts } from './player-shortcuts';
const stateNames = { idle: 'Готовий до відтворення', connecting: 'Приєднання до Voice…', buffering: 'Завантаження аудіо…', playing: 'Зараз грає', paused: 'На паузі', reconnecting: 'Відновлення з’єднання…', stopping: 'Зупинка…', error: 'Помилка відтворення' };
function sameTrack(a: MediaTrack | null, b: MediaTrack) { return a?.provider === b.provider && a.providerItemId === b.providerItemId; }

export function MediaPlayerClient({ guildId, userId, initial, initialError }: { guildId: string; userId: string; initial: MediaSnapshot; initialError: string | null }) {
  const { snapshot, unavailable, message, transient, setMessage, send, pending } = useMediaController(guildId, initial, initialError);
  const { session, settings, controls } = snapshot;
  const { query, setQuery, results, searchPending, searched, source, setSource, mobileTab, setMobileTab, nextPage, search } = usePlayerSearch(guildId, userId, snapshot.providers, setMessage);
  const [clock, setClock] = useState(Date.now());
  const [accent, setAccent] = useState(() => cachedArtworkAccent(initial.session?.currentTrack?.artworkUrl ?? null));
  const offset = useRef(initial.serverTimestamp - Date.now());
  const [confirm, setConfirm] = useState<'STOP' | 'MOVE_SESSION' | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [volume, setVolume] = useState(initial.session?.volume ?? initial.settings.defaultVolume);
  const [queueFilter, setQueueFilter] = useState('');
  const searchForm = useRef<HTMLFormElement>(null);
  useEffect(() => { setQueueFilter(''); }, [guildId, userId]);
  useEffect(() => { setVolume(session?.volume ?? settings.defaultVolume); }, [session?.volume, settings.defaultVolume]);
  useEffect(() => { offset.current = snapshot.serverTimestamp - Date.now(); }, [snapshot.serverTimestamp]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const loadingTrack = pending.filter((job) => job.action.type === 'PLAY_TRACK').at(-1)?.track ?? null;
  const track = session?.currentTrack ?? null;
  const paused = session?.state === 'paused'; const enabled = settings.enabled;
  const can = (type: string) => Boolean(controls[type]) && !unavailable && enabled;
  const pendingTrack = (item: MediaTrack) => pending.some((job) => (job.action.type === 'ADD_TRACK' || job.action.type === 'PLAY_TRACK') && job.action.provider === item.provider && job.action.providerItemId === item.providerItemId);
  const pendingAdds = pending.filter((job) => job.action.type === 'ADD_TRACK' && job.track);
  const queueCount = (session?.queue.length ?? 0) + pendingAdds.length;
  const differentVoice = Boolean(session && snapshot.actorVoice.id !== session.voiceChannelId && (session.currentTrack || session.recoverable));
  const restoreHere = differentVoice && snapshot.canManage && snapshot.actorVoice.id;
  const progress = session ? mediaProgress(session, unavailable ? snapshot.serverTimestamp : clock + offset.current) : 0;
  const filtered = results.filter((item) => source === 'all' || source === 'playable' && item.playable || item.provider === source);
  const queueDuration = session?.queue.reduce((total, item) => total + (item.durationMs ?? 0), 0) ?? 0;
  const queueTime = queueDuration >= 3600000 ? `${Math.floor(queueDuration / 3600000)} год ${Math.floor(queueDuration % 3600000 / 60000)} хв` : mediaTime(queueDuration);
  const queueQuery = queueFilter.trim().toLocaleLowerCase();
  const matchesQueue = (item: MediaQueueItem) => `${item.title} ${item.artist} ${item.requestedByName}`.toLocaleLowerCase().includes(queueQuery);
  // Keep original positions when filtering; backend reordering still addresses the full queue.
  const upcoming = (session?.queue ?? []).map((item, index) => ({ item, index })).filter(({ item }) => matchesQueue(item));
  const played = [...(session?.played ?? [])].reverse().filter(matchesQueue);
  const playing = session?.state === 'playing' && !unavailable;
  const canToggle = Boolean(track && !loadingTrack && ['playing', 'paused'].includes(session?.state ?? '') && can(paused ? 'RESUME' : 'PAUSE'));
  const canSeek = Boolean(can('SEEK') && session?.currentTrack?.seekable && session.currentTrack.type === 'track' && session.currentTrack.durationMs && !loadingTrack && !pending.some((job) => ['SEEK', 'SKIP', 'STOP', 'PLAY_TRACK'].includes(job.action.type)));

  function focusSearch() {
    setMobileTab('search');
    requestAnimationFrame(() => { const input = searchForm.current?.querySelector<HTMLInputElement>('input[type="search"]'); input?.focus(); input?.select(); });
  }
  usePlayerShortcuts({
    canToggle, canSeek, blocked: Boolean(confirm || pending.length || loadingTrack),
    onToggle: () => send({ type: paused ? 'RESUME' : 'PAUSE' }),
    onSeek: (deltaMs) => { if (session?.currentTrack?.durationMs) send({ type: 'SEEK', queueItemId: session.currentTrack.queueItemId, positionMs: Math.max(0, Math.min(session.currentTrack.durationMs - 1, progress + deltaMs)) }); },
    onSearch: focusSearch,
  });

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
      {!current && <div className="media-row-actions"><Button variant="icon" aria-label={`Видалити: ${item.title}`} title="Прибрати зі зіграних" disabled={!snapshot.queueControls[item.queueItemId]?.remove || Boolean(unavailable)} onClick={() => session && send({ type: 'REMOVE_QUEUE_ITEM', queueItemId: item.queueItemId, expectedQueueVersion: session.queueVersion })}><MediaIcon name="remove" width="16" height="16" /></Button></div>}
    </li>;
  }
  return <div className="media-player" style={{ '--media-accent': accent } as CSSProperties}>
    <div className="media-status-line"><ModuleStatus state={!enabled ? 'disabled' : unavailable || !snapshot.engine.available ? 'degraded' : 'enabled'} />{snapshot.remoteControl && <span className="media-badge">Віддалене керування</span>}<span className={`media-sync${pending.length ? ' is-pending' : ''}`} role="status">{pending.length ? `Синхронізація · ${pending.length}` : 'Синхронізовано'}</span></div>
    {!enabled && <ModuleDisabledState title="Модуль вимкнено." description="Увімкніть Медіа, щоб слухати музику у Voice."><Link className="ui-button ui-button-secondary" href={`/servers/${guildId}/media/settings`}>Налаштування модуля</Link></ModuleDisabledState>}
    {unavailable && <p className="media-feedback is-error" role="alert">{unavailable}</p>}
    {enabled && !snapshot.engine.available && !unavailable && <p className="media-feedback is-error">Аудіодвигун недоступний. Перевірте <Link href={`/servers/${guildId}/media/diagnostics`}>діагностику</Link>.</p>}
    {differentVoice && <div className="media-voice-notice"><MediaIcon name="headphones" /><div><p>{session?.recoverable ? 'Збережена черга була в ' : 'SCRT відтворює музику в '}<strong>{session!.voiceChannelName}</strong>. {snapshot.actorVoice.name && `Ви перебуваєте в ${snapshot.actorVoice.name}.`}</p>{restoreHere ? <p>Натисніть «Відновити тут», щоб запустити збережену чергу у {snapshot.actorVoice.name}.</p> : session?.recoverable ? <p>Адміністратор Медіа може відновити чергу у вашому Voice.</p> : !snapshot.remoteControl && <p>Приєднайтеся до {session!.voiceChannelName}, щоб керувати плеєром.</p>}</div>{!session?.recoverable && can('MOVE_SESSION') && snapshot.actorVoice.id && <Button variant="secondary" onClick={() => setConfirm('MOVE_SESSION')}>Перемістити SCRT сюди</Button>}</div>}
    {message && <p className={`media-feedback${transient ? ' media-toast' : ''}`} role="status" aria-live="polite">{message}<button aria-label="Закрити повідомлення" onClick={() => setMessage('')}><MediaIcon name="remove" width="16" height="16" /></button></p>}
    <div className="media-workspace">
    <section className="media-player-card" aria-label="Плеєр" data-playback={playing ? 'playing' : paused ? 'paused' : 'idle'}>
      <div className="media-cover-main"><MediaCover url={track?.artworkUrl ?? null} onAccent={setAccent} />{track && <button className="media-cover-toggle" aria-label={paused ? 'Відновити з обкладинки' : 'Призупинити з обкладинки'} disabled={!canToggle} onClick={() => send({ type: paused ? 'RESUME' : 'PAUSE' })}><MediaIcon name={paused ? 'play' : 'pause'} width="48" height="48" /></button>}</div>
      <div className="media-current">
        <div className="media-eyebrow"><span className={`media-play-signal${playing ? ' is-active' : ''}`} aria-hidden="true"><span /><span /><span /><span /></span>{session ? stateNames[session.state] : 'Твоя музика у Voice'}{track && <span className="media-provider-label">{providerNames[track.provider]}</span>}</div>
        {loadingTrack && <p className="media-switch-status" role="status" aria-live="polite">{track ? 'Перемикаємо на' : 'Готуємо аудіо'}: <strong>{loadingTrack.title}</strong></p>}
        <h2 className="media-title-in" key={`title:${track ? `${track.provider}:${track.providerItemId}` : 'empty'}`} title={track?.title}>{track?.title ?? 'Що слухаємо сьогодні?'}</h2><div className="media-artist-row"><p className="media-artist">{track?.artist ?? 'Знайди трек і натисни ▶ на обкладинці.'}</p>
        {track && <div className="media-discovery-tools"><Button variant="ghost" disabled={searchPending || Boolean(unavailable) || track.artist.trim().length < 2} onClick={() => { const artist = track.artist.slice(0, 250); setSource('all'); focusSearch(); void search(false, artist); }}><MediaIcon name="search" width="14" height="14" />Ще від виконавця</Button><a href={track.externalUrl} target="_blank" rel="noopener noreferrer" title={`Відкрити у ${providerNames[track.provider]}`}><MediaIcon name="external" width="14" height="14" />Джерело</a></div>}
        </div>
        {session?.recoverable && !loadingTrack && <div className="media-recovery"><p>{session.lastError ?? 'Чергу збережено. Відновіть сесію, щоб продовжити.'}</p><Button disabled={!can('RESTORE')} onClick={() => send({ type: 'RESTORE' })}>{restoreHere ? 'Відновити тут' : 'Відновити'}</Button></div>}
        <PlayerProgress key={`progress:${session?.currentTrack?.queueItemId ?? 'empty'}`} track={track} progress={progress} maxDurationMs={settings.maxTrackDurationSeconds * 1000} canSeek={canSeek} onSeek={(positionMs) => { if (session?.currentTrack) send({ type: 'SEEK', queueItemId: session.currentTrack.queueItemId, positionMs }); }} />
        <div className="media-transport"><div className="media-controls">
          <Button className="media-control-round" variant="ghost" title="Перемішати чергу" aria-label="Перемішати чергу" aria-pressed={session?.shuffle ?? false} disabled={!session || !can('SET_SHUFFLE')} onClick={() => send({ type: 'SET_SHUFFLE', shuffle: !session?.shuffle })}><MediaIcon name="shuffle" /></Button>
          <Button className="media-control-play" aria-label={paused ? 'Відновити відтворення' : 'Призупинити відтворення'} disabled={!canToggle} onClick={() => send({ type: paused ? 'RESUME' : 'PAUSE' })}><MediaIcon name={paused ? 'play' : 'pause'} width="26" height="26" /></Button>
          <Button className="media-control-round" variant="ghost" title={controls.SKIP ? 'Наступний трек' : 'Голосувати за пропуск'} aria-label={controls.SKIP ? 'Наступний трек' : 'Голосувати за пропуск'} disabled={!track || !can(controls.SKIP ? 'SKIP' : 'VOTE_SKIP')} onClick={() => send({ type: controls.SKIP ? 'SKIP' : 'VOTE_SKIP' })}><MediaIcon name="next" />{!controls.SKIP && <small>{snapshot.votes.count}/{snapshot.votes.required}</small>}</Button>
          <Button className="media-control-round" variant="ghost" title="Повтор" aria-label="Повтор треку або черги" aria-pressed={session?.repeatMode !== 'off' && Boolean(session)} disabled={!session || !can('SET_REPEAT')} onClick={() => send({ type: 'SET_REPEAT', repeatMode: session?.repeatMode === 'off' ? 'queue' : session?.repeatMode === 'queue' ? 'track' : 'off' })}><MediaIcon name="repeat" />{session?.repeatMode === 'track' && <small>1</small>}</Button>
          <Button className="media-control-round" variant="ghost" title="Зупинити сесію" aria-label="Зупинити сесію" disabled={!session || !can('STOP')} onClick={() => setConfirm('STOP')}><MediaIcon name="stop" /></Button>
        </div><label className="media-volume"><MediaIcon name="volume" /><Input type="range" aria-label="Гучність" min={0} max={settings.maxVolume} value={volume} disabled={!session || !can('SET_VOLUME')} onChange={(event) => setVolume(Number(event.target.value))} onPointerUp={() => { if (volume !== session?.volume) send({ type: 'SET_VOLUME', volume }); }} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && volume !== session?.volume) send({ type: 'SET_VOLUME', volume }); }} /><span>{volume}%</span></label></div>
        <div className="media-player-footer"><span className="media-listeners"><MediaIcon name="headphones" />{session?.voiceChannelName ?? snapshot.actorVoice.name ?? 'Приєднайся до Voice'}{session && <span>· {snapshot.listenerCount} слухачів</span>}</span><details className="media-options"><summary>Керування</summary><div><label>Повтор<Select aria-label="Повтор" value={session?.repeatMode ?? 'off'} disabled={!session || !can('SET_REPEAT')} onChange={(event) => send({ type: 'SET_REPEAT', repeatMode: event.target.value as 'off' | 'track' | 'queue' })}><option value="off">Вимкнено</option><option value="track">Трек</option><option value="queue">Черга</option></Select></label><label>Доступ<Select aria-label="Обмеження керування" value={session?.lockedMode ?? 'unlocked'} disabled={!session || !can('SET_LOCK')} onChange={(event) => send({ type: 'SET_LOCK', lockedMode: event.target.value as 'unlocked' | 'dj' | 'admin' })}><option value="unlocked">Учасники Voice</option><option value="dj">DJ</option><option value="admin" disabled={!snapshot.canManage}>Адміністратор</option></Select></label></div></details></div>
        {session?.lastError && !session.recoverable && <p className="field-help">{session.lastError}</p>}
        <PlayerNextTrack session={session} loading={Boolean(loadingTrack)} />
        <div className="media-shortcut-hint" aria-label="Гарячі клавіші">{canToggle && <span><kbd>Пробіл</kbd> {paused ? 'відтворення' : 'пауза'}</span>}{can('SEEK') && track?.seekable && <span><kbd>J</kbd> / <kbd>L</kbd> ±10 с</span>}<span><kbd>/</kbd> пошук</span></div>
      </div>
    </section>
    <div className="media-mobile-tabs"><Button variant="secondary" aria-pressed={mobileTab === 'search'} onClick={() => setMobileTab('search')}>Пошук</Button><Button variant="secondary" aria-pressed={mobileTab === 'queue'} onClick={() => setMobileTab('queue')}>Черга · {queueCount}</Button></div>
    <div className="media-columns" data-mobile-tab={mobileTab}>
      <section className="media-search" aria-label="Пошук музики"><div className="media-section-heading"><div><h2>Знайти музику</h2><p>Назва, виконавець або посилання на трек</p></div><MediaIcon name="search" /></div>
        <form className="media-search-form" ref={searchForm} onSubmit={(event) => { event.preventDefault(); void search(); }}><div className="media-search-input"><MediaIcon name="search" /><Input type="search" value={query} aria-label="Пошук треку, виконавця або URL" placeholder="Що хочеш послухати?" minLength={2} maxLength={250} onChange={(event) => setQuery(event.target.value)} /></div><Button type="submit" disabled={searchPending || query.trim().length < 2 || Boolean(unavailable)}>{searchPending ? 'Пошук…' : 'Знайти'}</Button></form>
        <div className="media-source-filters" aria-label="Джерела пошуку"><Button variant="ghost" aria-pressed={source === 'all'} onClick={() => setSource('all')}>Усі</Button><Button variant="ghost" aria-pressed={source === 'playable'} onClick={() => setSource('playable')}>Для відтворення</Button>{snapshot.providers.filter((provider) => provider.state !== 'unconfigured').map((provider) => <Button key={provider.id} variant="ghost" aria-pressed={source === provider.id} onClick={() => setSource(provider.id)}>{providerNames[provider.id]}</Button>)}</div>
        <ul className="media-track-list media-search-results" aria-label="Результати пошуку" aria-busy={searchPending}>{filtered.map((item) => {
          const current = sameTrack(session?.currentTrack ?? null, item); const allowed = current && !loadingTrack ? can(paused ? 'RESUME' : 'PAUSE') : can('PLAY_TRACK');
          return <li key={`${item.provider}:${item.providerItemId}`} className={current ? 'is-current' : ''}>
            {item.playable ? <button className="media-artwork-button" aria-label={`${current && !loadingTrack ? paused ? 'Відновити' : 'Призупинити' : 'Відтворити'}: ${item.title}`} title={allowed ? 'Відтворити звідси й продовжити добірку' : 'Перемикання треків потребує дозволу DJ або адміністратора.'} disabled={!allowed || !snapshot.engine.available} onClick={() => play(item, true)}><MediaArtwork track={item} /><span className="media-artwork-overlay"><MediaIcon name={current && !loadingTrack && !paused ? 'pause' : 'play'} /></span></button> : <MediaArtwork track={item} />}
            <div className="media-track-info"><strong title={item.title}>{item.title}</strong><span>{item.artist}</span><small>{providerNames[item.provider]} · {item.type === 'live' ? 'LIVE' : mediaTime(item.durationMs)}{!item.playable && ' · Лише інформація'}{item.explicit === true && ' · Explicit'}</small></div>
            {item.playable ? <Button className="media-add-button" variant="ghost" aria-label={`Додати до черги: ${item.title}`} disabled={!can('ADD_TRACK') || !snapshot.engine.available || pendingTrack(item)} title="Додати в кінець черги" onClick={() => send({ type: 'ADD_TRACK', provider: item.provider, providerItemId: item.providerItemId }, item)}><MediaIcon name="plus" /><span>{pending.some((job) => job.action.type === 'PLAY_TRACK' && job.track && sameTrack(job.track, item)) ? 'Запускається…' : pendingTrack(item) ? 'Додається…' : 'Додати'}</span></Button> : <a className="ui-button ui-button-ghost" href={item.externalUrl} target="_blank" rel="noopener noreferrer">Відкрити у {item.provider}</a>}
          </li>;
        })}</ul>
        {nextPage !== null && <div className="media-load-more"><Button variant="secondary" disabled={searchPending || Boolean(unavailable)} onClick={() => void search(true)}>{searchPending ? 'Завантаження…' : 'Завантажити ще'}</Button><span>{results.length} результатів</span></div>}
        {!filtered.length && <div className="media-empty"><MediaIcon name="search" width="32" height="32" /><strong>{searched ? 'Спробуй інший запит' : 'Музика починається з пошуку'}</strong><p>Встав посилання YouTube, YouTube Music, SoundCloud чи аудіофайлу або знайди трек за назвою. Spotify надає лише інформацію про треки.</p></div>}
      </section>
      <section className="media-queue" aria-label="Черга відтворення"><div className="media-section-heading"><div><h2>Черга <span className="media-count">{queueCount}</span></h2><p>{queueDuration ? `${session?.queue.some((item) => item.durationMs === null) ? 'Від ' : ''}${queueTime} музики попереду · ` : ''}{session?.queueMode === 'fair' ? 'Справедлива черга' : 'Зіграні треки залишаються для повтору'}</p></div><MediaIcon name="queue" /></div>
        {Boolean(session?.queue.length || session?.played.length) && <div className="media-queue-filter"><MediaIcon name="search" width="16" height="16" /><Input type="text" aria-label="Фільтр черги та зіграних треків" placeholder="Знайти в черзі…" maxLength={100} value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)} />{queueFilter && <Button variant="ghost" aria-label="Очистити фільтр черги" onClick={() => setQueueFilter('')}><MediaIcon name="remove" width="14" height="14" /></Button>}</div>}
        <div className="media-queue-content" tabIndex={0} aria-label="Список треків у черзі">
        {session?.currentTrack && <ul className="media-track-list media-queue-list" aria-label="Поточний трек">{retainedRow(session.currentTrack, true)}</ul>}
        {Boolean(session?.queue.length || pendingAdds.length) && <h3 className="media-queue-group">Далі · {upcoming.length + pendingAdds.length}{queueQuery && ` із ${queueCount}`}</h3>}
        {upcoming.length || pendingAdds.length ? <ol className="media-track-list media-queue-list" aria-label="Наступні треки">{upcoming.map(({ item, index }) => {
          const allowed = snapshot.queueControls[item.queueItemId];
          return <li key={item.queueItemId} className={dragging === item.queueItemId ? 'is-dragging' : ''} draggable={Boolean(allowed?.move) && !unavailable && !queueQuery} onDragStart={(event) => { setDragging(item.queueItemId); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.queueItemId); }} onDragEnd={() => setDragging(null)} onDragOver={(event) => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); if (dragging && dragging !== item.queueItemId && snapshot.queueControls[dragging]?.move) move(dragging, index); setDragging(null); }}>
            <span className="media-queue-position">{index + 1}</span><button className="media-artwork-button" aria-label={`Відтворити з черги: ${item.title}`} disabled={!can('PLAY_TRACK') || !snapshot.engine.available} onClick={() => play(item)}><MediaArtwork track={item} /><span className="media-artwork-overlay"><MediaIcon name="play" /></span></button>
            <div className="media-track-info"><strong title={item.title}>{item.title}</strong><span>{item.artist} · {mediaTime(item.durationMs)}</span><small>Додав {item.requestedByName}</small></div>
            <div className="media-row-actions"><Button variant="icon" title="Перемістити вище" aria-label={`Перемістити вище: ${item.title}`} disabled={index === 0 || !allowed?.move || Boolean(unavailable)} onClick={() => move(item.queueItemId, index - 1)}><MediaIcon name="up" width="16" height="16" /></Button><Button variant="icon" title="Перемістити нижче" aria-label={`Перемістити нижче: ${item.title}`} disabled={index === (session?.queue.length ?? 0) - 1 || !allowed?.move || Boolean(unavailable)} onClick={() => move(item.queueItemId, index + 1)}><MediaIcon name="down" width="16" height="16" /></Button><Button variant="icon" title="Видалити з черги" aria-label={`Видалити: ${item.title}`} disabled={!allowed?.remove || Boolean(unavailable)} onClick={() => session && send({ type: 'REMOVE_QUEUE_ITEM', queueItemId: item.queueItemId, expectedQueueVersion: session.queueVersion })}><MediaIcon name="remove" width="16" height="16" /></Button></div>
          </li>;
        })}{pendingAdds.map((job) => <li className="media-pending-row" key={job.id}><span className="media-queue-position">…</span><MediaArtwork track={job.track!} /><div className="media-track-info"><strong>{job.track!.title}</strong><small>Додається до черги…</small></div></li>)}</ol> : !session?.played.length && !session?.currentTrack && <div className="media-empty"><MediaIcon name="queue" width="36" height="36" /><strong>Тут буде твоя добірка</strong><p>Натисни ▶ у пошуку, щоб слухати звідти й далі. Кнопка + додає лише вибраний трек у чергу.</p></div>}
        {queueQuery && !upcoming.length && !played.length && <p className="media-filter-empty" role="status">Немає збігів у черзі та зіграних треках.</p>}
        {Boolean(session?.queue.length) && <p className="media-queue-help">{queueQuery ? 'Стрілки змінюють позицію в повній черзі.' : 'Перетягни трек або скористайся стрілками, щоб змінити порядок.'}</p>}
        {Boolean(session?.played.length) && <details className="media-played-details"><summary><MediaIcon name="history" width="16" height="16" /><span>Зіграні</span><span className="media-count">{played.length}</span><MediaIcon name="down" width="14" height="14" /></summary><ul className="media-track-list media-queue-list" aria-label="Зіграні треки">{played.map((item) => retainedRow(item))}</ul></details>}
        </div>
      </section>
    </div>
    </div>
    <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm === 'MOVE_SESSION' ? 'Перемістити SCRT сюди?' : 'Зупинити відтворення?'} description={confirm === 'MOVE_SESSION' ? 'Черга залишиться. Поточний трек почнеться спочатку у вашому голосовому каналі.' : 'SCRT залишить Voice. Наступні треки збережуться для відновлення.'} footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Скасувати</Button><Button onClick={() => { const type = confirm; setConfirm(null); if (type) send({ type }); }}>Підтвердити</Button></>} />
  </div>;
}
