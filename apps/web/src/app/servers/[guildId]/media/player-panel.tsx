'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MediaSnapshot } from '@scrt/validation';
import { mediaProgress } from '@scrt/shared';
import { Button, Input } from '@/app/components/controls';
import { Select } from '@/app/components/select';
import { Dialog } from '@/app/components/dialog';
import { MediaIcon } from './media-icon';
import { FavoriteButton } from './favorites-context';
import { neutralPalette, artworkPaletteStyle, MediaCover, type ArtworkPalette } from './player-artwork';
import { providerNames } from './media-track';
import { PlayerProgress } from './player-progress';
import { PlayerNextTrack } from './player-next-track';
import { usePlayerShortcuts } from './player-shortcuts';
import { useWorkspaceMediaController } from '@/app/components/media-player/media-player-context';
const stateNames = { idle: 'Готовий до відтворення', connecting: 'Приєднання до Voice…', buffering: 'Завантаження аудіо…', playing: 'Зараз грає', paused: 'На паузі', reconnecting: 'Відновлення з’єднання…', stopping: 'Зупинка…', error: 'Помилка відтворення' };

export function MediaPlaybackPanel({ guildId, initial, initialError, active = true, showFeedback = true, onPalette }: { guildId: string; initial: MediaSnapshot; initialError: string | null; active?: boolean; showFeedback?: boolean; onPalette?: (palette: ArtworkPalette) => void }) {

  const { snapshot, unavailable, message, transient, setMessage, send, pending } = useWorkspaceMediaController(guildId, initial, initialError);
  const { session, settings, controls } = snapshot;
  const [clock, setClock] = useState(initial.serverTimestamp);
  const [palette, setPalette] = useState(neutralPalette);
  useEffect(() => { onPalette?.(palette); }, [palette, onPalette]);
  const offset = useRef(0);
  const [confirm, setConfirm] = useState<'STOP' | 'MOVE_SESSION' | null>(null);
  const [volume, setVolume] = useState(initial.session?.volume ?? initial.settings.defaultVolume);
  useEffect(() => { if (!active) setConfirm(null); }, [active]);
  useEffect(() => { setVolume(session?.volume ?? settings.defaultVolume); }, [session?.volume, settings.defaultVolume]);
  useEffect(() => { const now = Date.now(); offset.current = snapshot.serverTimestamp - now; setClock(now); }, [snapshot.serverTimestamp]);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const loadingTrack = pending.filter((job) => job.action.type === 'PLAY_TRACK').at(-1)?.track ?? null;
  const track = session?.currentTrack ?? null;
  const paused = session?.state === 'paused';
  const can = (type: string) => Boolean(controls[type]) && !unavailable && settings.enabled;
  const differentVoice = Boolean(session && snapshot.actorVoice.id !== session.voiceChannelId && (session.currentTrack || session.recoverable));
  const restoreHere = differentVoice && snapshot.canManage && snapshot.actorVoice.id;
  const progress = session ? mediaProgress(session, unavailable ? snapshot.serverTimestamp : clock + offset.current) : 0;
  const playing = session?.state === 'playing' && !unavailable;
  const canToggle = Boolean(track && !loadingTrack && ['playing', 'paused'].includes(session?.state ?? '') && can(paused ? 'RESUME' : 'PAUSE'));
  const canSeek = Boolean(can('SEEK') && track?.seekable && track.type === 'track' && track.durationMs && !loadingTrack && !pending.some((job) => ['SEEK', 'SKIP', 'STOP', 'PLAY_TRACK'].includes(job.action.type)));
  const previousTrack = session?.played.filter((item) => item.playable && (item.provider !== track?.provider || item.providerItemId !== track?.providerItemId)).at(-1);
  const canPrevious = !loadingTrack && !pending.some((job) => ['SEEK', 'SKIP', 'STOP', 'PLAY_TRACK'].includes(job.action.type)) && (previousTrack ? can('PLAY_TRACK') : Boolean(track && canSeek));
  usePlayerShortcuts({ canToggle, canSeek, blocked: !active || Boolean(confirm || pending.length || loadingTrack),
    onToggle: () => send({ type: paused ? 'RESUME' : 'PAUSE' }),
    onSeek: (deltaMs) => { if (session?.currentTrack?.durationMs) send({ type: 'SEEK', queueItemId: session.currentTrack.queueItemId, positionMs: Math.max(0, Math.min(session.currentTrack.durationMs - 1, progress + deltaMs)) }); },
  });

  return <div className="media-playback-panel" style={artworkPaletteStyle(palette)}>
    {showFeedback && unavailable && <p className="media-feedback is-error" role="status">{unavailable}</p>}
    {showFeedback && !settings.enabled && <p className="media-feedback">Модуль Медіа вимкнено.</p>}
    {showFeedback && settings.enabled && !snapshot.engine.available && !unavailable && <p className="media-feedback is-error">Аудіодвигун недоступний. <Link href={`/servers/${guildId}/media/diagnostics`}>Діагностика</Link></p>}
    {showFeedback && differentVoice && !session?.recoverable && <div className="media-voice-notice"><MediaIcon name="headphones" /><div><p>SCRT у <strong>{session!.voiceChannelName}</strong>.</p>{!snapshot.remoteControl && <p>Приєднайтеся до цього Voice для керування.</p>}</div>{can('MOVE_SESSION') && snapshot.actorVoice.id && <Button variant="secondary" onClick={() => setConfirm('MOVE_SESSION')}>Перемістити сюди</Button>}</div>}
    {showFeedback && message && <p className={`media-feedback${transient ? ' is-success' : ''}`} role="status">{message}<button aria-label="Закрити повідомлення плеєра" onClick={() => setMessage('')}><MediaIcon name="remove" width="16" height="16" /></button></p>}
    <section className="media-player-card" aria-label="Плеєр" data-playback={playing ? 'playing' : paused ? 'paused' : 'idle'}>
      <div className="media-cover-main"><MediaCover url={track?.artworkUrl ?? null} onPalette={setPalette} />{track && <button className="media-cover-toggle" aria-label={paused ? 'Відновити з обкладинки' : 'Призупинити з обкладинки'} disabled={!canToggle} onClick={() => send({ type: paused ? 'RESUME' : 'PAUSE' })}><MediaIcon name={paused ? 'play' : 'pause'} width="48" height="48" /></button>}</div>
      <div className="media-current">
        <div className="media-eyebrow"><span className={`media-play-signal${playing ? ' is-active' : ''}`} aria-hidden="true"><span /><span /><span /><span /></span>{session ? stateNames[session.state] : 'Твоя музика у Voice'}{track && <a className="media-provider-label" href={track.externalUrl} target="_blank" rel="noopener noreferrer" title={`Відкрити цей трек у ${providerNames[track.provider]}`}>{providerNames[track.provider]}</a>}</div>
        {loadingTrack && <p className="media-switch-status" role="status" aria-live="polite">{track ? 'Перемикаємо на' : 'Готуємо аудіо'}: <strong>{loadingTrack.title}</strong></p>}
        <h2 className="media-title-in" key={`title:${track ? `${track.provider}:${track.providerItemId}` : 'empty'}`} title={track?.title}>{track?.title ?? 'Що слухаємо сьогодні?'}</h2><div className="media-artist-row"><p className="media-artist">{track?.artist ?? 'Знайди трек і натисни ▶ на обкладинці.'}</p>
        {track && <div className="media-discovery-tools"><FavoriteButton track={track} /><Link href={`/servers/${guildId}/media`}><MediaIcon name="search" width="14" height="14" />Знайти музику</Link><a href={track.externalUrl} target="_blank" rel="noopener noreferrer" title={`Відкрити у ${providerNames[track.provider]}`}><MediaIcon name="external" width="14" height="14" />Джерело</a></div>}
        </div>
        {session?.recoverable && !loadingTrack && <div className="media-recovery"><p>{session.lastError ?? 'Чергу збережено. Відновіть сесію, щоб продовжити.'}</p><Button onClick={() => send({ type: 'RESTORE' })}>{restoreHere ? 'Відновити тут' : 'Відновити'}</Button></div>}
        <PlayerProgress key={`progress:${session?.currentTrack?.queueItemId ?? 'empty'}`} track={track} progress={progress} maxDurationMs={settings.maxTrackDurationSeconds * 1000} canSeek={canSeek} onSeek={(positionMs) => { if (session?.currentTrack) send({ type: 'SEEK', queueItemId: session.currentTrack.queueItemId, positionMs }); }} />
        <div className="media-transport"><div className="media-controls">
          <Button className="media-control-round" variant="ghost" title="Перемішати чергу" aria-label="Перемішати чергу" aria-pressed={session?.shuffle ?? false} disabled={!session || !can('SET_SHUFFLE')} onClick={() => send({ type: 'SET_SHUFFLE', shuffle: !session?.shuffle })}><MediaIcon name="shuffle" /></Button>
          <Button className="media-control-round" variant="ghost" title={previousTrack ? `Попередній трек: ${previousTrack.title}` : 'На початок треку'} aria-label={previousTrack ? 'Попередній трек' : 'На початок треку'} disabled={!canPrevious} onClick={() => {
            if (previousTrack) send({ type: 'PLAY_TRACK', provider: previousTrack.provider, providerItemId: previousTrack.providerItemId }, previousTrack);
            else if (track) send({ type: 'SEEK', queueItemId: track.queueItemId, positionMs: 0 });
          }}><MediaIcon name="previous" /></Button>
          <Button className="media-control-play" aria-label={paused ? 'Відновити відтворення' : 'Призупинити відтворення'} disabled={!canToggle} onClick={() => send({ type: paused ? 'RESUME' : 'PAUSE' })}><MediaIcon name={paused ? 'play' : 'pause'} width="26" height="26" /></Button>
          <Button className="media-control-round" variant="ghost" title={controls.SKIP ? 'Наступний трек' : 'Голосувати за пропуск'} aria-label={controls.SKIP ? 'Наступний трек' : 'Голосувати за пропуск'} disabled={!track || !can(controls.SKIP ? 'SKIP' : 'VOTE_SKIP')} onClick={() => send({ type: controls.SKIP ? 'SKIP' : 'VOTE_SKIP' })}><MediaIcon name="next" />{!controls.SKIP && <small>{snapshot.votes.count}/{snapshot.votes.required}</small>}</Button>
          <Button className="media-control-round" variant="ghost" title="Повтор" aria-label="Повтор треку або черги" aria-pressed={session?.repeatMode !== 'off' && Boolean(session)} disabled={!session || !can('SET_REPEAT')} onClick={() => send({ type: 'SET_REPEAT', repeatMode: session?.repeatMode === 'off' ? 'queue' : session?.repeatMode === 'queue' ? 'track' : 'off' })}><MediaIcon name="repeat" />{session?.repeatMode === 'track' && <small>1</small>}</Button>
          <Button className="media-control-round" variant="ghost" title="Зупинити сесію" aria-label="Зупинити сесію" disabled={!session || !can('STOP')} onClick={() => setConfirm('STOP')}><MediaIcon name="stop" /></Button>
        </div><label className="media-volume"><MediaIcon name="volume" /><Input type="range" aria-label="Гучність" min={0} max={settings.maxVolume} value={volume} disabled={!session || !can('SET_VOLUME')} onChange={(event) => setVolume(Number(event.target.value))} onPointerUp={() => { if (volume !== session?.volume) send({ type: 'SET_VOLUME', volume }); }} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && volume !== session?.volume) send({ type: 'SET_VOLUME', volume }); }} /><span>{volume}%</span></label></div>
        <div className="media-player-footer"><span className="media-listeners"><MediaIcon name="headphones" />{session?.voiceChannelName ?? snapshot.actorVoice.name ?? 'Приєднайся до Voice'}{session && <span>· {snapshot.listenerCount} слухачів</span>}</span><details className="media-options"><summary>Керування</summary><div><label>Повтор<Select aria-label="Повтор" value={session?.repeatMode ?? 'off'} disabled={!session || !can('SET_REPEAT')} onChange={(event) => send({ type: 'SET_REPEAT', repeatMode: event.target.value as 'off' | 'track' | 'queue' })}><option value="off">Вимкнено</option><option value="track">Трек</option><option value="queue">Черга</option></Select></label><label>Доступ<Select aria-label="Обмеження керування" value={session?.lockedMode ?? 'unlocked'} disabled={!session || !can('SET_LOCK')} onChange={(event) => send({ type: 'SET_LOCK', lockedMode: event.target.value as 'unlocked' | 'dj' | 'admin' })}><option value="unlocked">Учасники Voice</option><option value="dj">DJ</option><option value="admin" disabled={!snapshot.canManage}>Адміністратор</option></Select></label></div></details></div>
        {session?.lastError && !session.recoverable && <p className="field-help">{session.lastError}</p>}
        <PlayerNextTrack session={session} loading={Boolean(loadingTrack)} />
        <div className="media-shortcut-hint" aria-label="Гарячі клавіші">{canToggle && <span><kbd>Пробіл</kbd> {paused ? 'відтворення' : 'пауза'}</span>}{can('SEEK') && track?.seekable && <span><kbd>J</kbd> / <kbd>L</kbd> ±10 с</span>}</div>
      </div>
    </section>

    <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm === 'MOVE_SESSION' ? 'Перемістити SCRT сюди?' : 'Зупинити відтворення?'} description={confirm === 'MOVE_SESSION' ? 'Черга залишиться. Поточний трек почнеться спочатку у вашому голосовому каналі.' : 'SCRT залишить Voice. Наступні треки збережуться для відновлення.'} footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Скасувати</Button><Button onClick={() => { const type = confirm; setConfirm(null); if (type) send({ type }); }}>Підтвердити</Button></>} />

  </div>;
}
