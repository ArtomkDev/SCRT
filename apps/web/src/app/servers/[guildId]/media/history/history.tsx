'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MediaHistoryItem } from '@scrt/shared';
import { mediaHistoryDeleteResultSchema, mediaHistoryPageSchema, type MediaHistoryDelete, type MediaHistoryPage, type MediaSnapshot } from '@scrt/validation';
import { Button } from '@/app/components/controls';
import { Dialog } from '@/app/components/dialog';
import { MediaIcon } from '../media-icon';
import { MediaArtwork, mediaTime, providerNames } from '../media-track';
import { mediaResponse, useMediaController } from '../player-controller';

const resultNames = { finished: 'Завершено', skipped: 'Пропущено', failed: 'Помилка' };
const dateFormat = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Kyiv' });
const timeFormat = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });

export function MediaHistoryClient({ guildId, userId, history, initial, initialError }: { guildId: string; userId: string; history: MediaHistoryPage; initial: MediaSnapshot; initialError: string | null }) {
  const { snapshot, pending, send, unavailable, message, setMessage } = useMediaController(guildId, initial, initialError);
  const endpoint = `/api/guilds/${guildId}/media`;
  const [items, setItems] = useState(history.items);
  const [next, setNext] = useState(history.next);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<MediaHistoryItem | 'all' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletedCount, setDeletedCount] = useState(0);
  const [deleteError, setDeleteError] = useState('');
  const active = useRef(true);
  const read = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; read.current?.abort(); mutation.current?.abort(); }; }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3200); return () => clearTimeout(timer); }, [notice]);

  async function loadMore() {
    if (!next || loading || deleting) return;
    const abort = new AbortController(); read.current?.abort(); read.current = abort;
    setLoading(true); setHistoryError('');
    try {
      const query = new URLSearchParams({ history: '1', before: String(next.endedAt), beforeId: next.id });
      const page = mediaHistoryPageSchema.parse(await mediaResponse(await fetch(`${endpoint}?${query}`, { cache: 'no-store', signal: abort.signal })));
      if (active.current && !abort.signal.aborted) {
        setItems((current) => [...current, ...page.items.filter((item) => !current.some((entry) => entry.id === item.id))]);
        setNext(page.next);
      }
    } catch (error) { if (active.current && !abort.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'Не вдалося завантажити історію.'); }
    finally { if (active.current && !abort.signal.aborted) setLoading(false); }
  }

  async function remove() {
    if (!confirm || deleting) return;
    const target = confirm;
    const action: MediaHistoryDelete = target === 'all' ? { type: 'CLEAR_OWN' } : { type: 'DELETE_ITEM', id: target.id };
    const abort = new AbortController(); mutation.current = abort;
    read.current?.abort(); setLoading(false); setDeleting(true); setDeleteError(''); setDeletedCount(0);
    let count = 0;
    try {
      let more = true;
      while (more && !abort.signal.aborted) {
        const result = mediaHistoryDeleteResultSchema.parse(await mediaResponse(await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal: abort.signal })));
        count += result.deleted; more = result.more;
        if (active.current && !abort.signal.aborted) setDeletedCount(count);
        if (more && result.deleted === 0) throw new Error('Очищення перервано. Спробуйте ще раз.');
      }
      if (active.current && !abort.signal.aborted) {
        setItems((current) => current.filter((item) => target === 'all' ? item.track.requestedByUserId !== userId : item.id !== target.id));
        setConfirm(null); setNotice(target === 'all' ? 'Вашу історію очищено.' : 'Запис видалено.');
      }
    } catch (error) {
      if (active.current && !abort.signal.aborted) {
        setDeleteError(`${error instanceof Error ? error.message : 'Не вдалося видалити історію.'}${count ? ` Уже видалено записів: ${count}.` : ''}`);
        // A large cleanup can succeed in part. Reload the first page rather than
        // displaying entries that were already removed by earlier batches.
        if (count) {
          try {
            const page = mediaHistoryPageSchema.parse(await mediaResponse(await fetch(`${endpoint}?history=1`, { cache: 'no-store', signal: abort.signal })));
            if (active.current && !abort.signal.aborted) { setItems(page.items); setNext(page.next); }
          } catch { /* Keep the deletion error and allow a retry. */ }
        }
      }
    } finally { if (active.current && !abort.signal.aborted) setDeleting(false); }
  }

  function requestDelete(item: MediaHistoryItem | 'all') { setDeleteError(''); setDeletedCount(0); setConfirm(item); }
  const current = snapshot.session?.currentTrack;
  const pendingTrack = pending.filter((job) => job.action.type === 'PLAY_TRACK').at(-1)?.track;
  const groups = new Map<string, MediaHistoryItem[]>();
  for (const item of items) { const date = dateFormat.format(item.playedAt); groups.set(date, [...(groups.get(date) ?? []), item]); }

  return <section className="media-history" aria-label="Історія відтворення">
    <header className="media-history-header">
      <div className="media-history-heading"><span className="media-history-symbol"><MediaIcon name="history" width="24" height="24" /></span><div><h2>Історія відтворення</h2><p>Поверніться до музики, яку слухали разом.</p></div></div>
      <Button variant="secondary" className="media-history-clear" disabled={deleting || !items.length && !next} onClick={() => requestDelete('all')}><MediaIcon name="trash" width="16" height="16" />Очистити мою історію</Button>
    </header>
    <div className="media-history-toolbar">
      <span>{items.length ? `Завантажено ${items.length} записів` : 'Поки немає записів'} · Зберігаються {snapshot.settings.historyRetentionDays} днів</span>
      <Link href={`/servers/${guildId}/media`} className="media-history-now" aria-live="polite"><MediaIcon name={pendingTrack || current ? 'volume' : 'headphones'} width="15" height="15" /><span>{pendingTrack ? `Запускаємо: ${pendingTrack.title}` : current ? `${snapshot.session?.state === 'paused' ? 'На паузі' : 'У плеєрі'}: ${current.title}` : 'Перейти до плеєра'}</span></Link>
    </div>
    {unavailable && <p className="media-feedback is-error" role="status">{unavailable} Історія та її очищення доступні.</p>}
    {!unavailable && !snapshot.actorVoice.id && !snapshot.remoteControl && <p className="media-history-hint"><MediaIcon name="headphones" width="16" height="16" />Приєднайтеся до голосового каналу, щоб увімкнути трек з історії.</p>}
    {(message || historyError) && <p className="media-feedback is-error" role="alert">{message || historyError}<button aria-label="Закрити повідомлення" onClick={() => { setMessage(''); setHistoryError(''); }}><MediaIcon name="remove" width="16" height="16" /></button></p>}
    <div className="media-history-list">
      {items.length > 0 && <div className="media-history-columns" aria-hidden="true"><span>Трек</span><span>Додав</span><span>Час</span><span>Результат</span><span /></div>}
      {[...groups].map(([date, entries]) => <section className="media-history-day" key={date} aria-label={date}>
        <h3>{date}</h3><ul>{entries.map((item) => {
          const track = item.track;
          const same = current?.provider === track.provider && current.providerItemId === track.providerItemId;
          const paused = same && snapshot.session?.state === 'paused';
          const playing = same && snapshot.session?.state === 'playing';
          const busy = pending.some((job) => job.action.type === 'PLAY_TRACK' && job.action.provider === track.provider && job.action.providerItemId === track.providerItemId);
          const action = paused ? 'RESUME' : 'PLAY_TRACK';
          const allowed = track.playable && snapshot.settings.enabled && snapshot.engine.available && snapshot.controls[action] && !unavailable;
          const own = track.requestedByUserId === userId;
          return <li key={item.id} className={`media-history-row${same ? ' is-current' : ''}${busy ? ' is-pending' : ''}`}>
            <div className="media-history-track">
              <button className="media-artwork-button" aria-label={`${playing ? 'Зараз грає' : paused ? 'Відновити' : 'Відтворити'}: ${track.title}`} title={playing ? 'Цей трек уже грає' : !track.playable ? 'Джерело не підтримує відтворення' : allowed ? 'Відтворити зараз' : 'Потрібне підключення до Voice та дозвіл на керування плеєром'} disabled={!allowed || playing || busy} onClick={() => send(paused ? { type: 'RESUME' } : { type: 'PLAY_TRACK', provider: track.provider, providerItemId: track.providerItemId }, track)}>
                <MediaArtwork track={track} /><span className="media-artwork-overlay"><MediaIcon name={playing || busy ? 'volume' : 'play'} /></span>
              </button>
              <div className="media-track-info"><strong title={track.title}>{track.title}</strong><span title={track.artist}>{track.artist || 'Невідомий виконавець'}</span><small>{busy ? 'Запускаємо…' : `${providerNames[track.provider]} · ${track.type === 'live' ? 'LIVE' : mediaTime(track.durationMs)}`}</small></div>
            </div>
            <div className="media-history-requester"><span title={track.requestedByName}>{track.requestedByName || 'Учасник'}</span>{own && <small>Ви</small>}</div>
            <time className="media-history-time" dateTime={new Date(item.playedAt).toISOString()} title={`${date} о ${timeFormat.format(item.playedAt)}`}>{timeFormat.format(item.playedAt)}</time>
            <span className={`media-history-result is-${item.result}`} title={item.reason ?? undefined}><i />{resultNames[item.result]}</span>
            <div className="media-history-actions">{own && <Button variant="icon" aria-label={`Видалити запис: ${track.title}`} title="Видалити мій запис з історії" disabled={deleting} onClick={() => requestDelete(item)}><MediaIcon name="trash" width="17" height="17" /></Button>}</div>
          </li>;
        })}</ul>
      </section>)}
      {!items.length && <div className="media-empty media-history-empty"><MediaIcon name="history" width="40" height="40" /><strong>Тут з’явиться ваша музика</strong><p>Зіграні та пропущені треки зберігаються тут. Натисніть ▶ на обкладинці, щоб слухати їх знову.</p><Link className="ui-button ui-button-secondary" href={`/servers/${guildId}/media`}>Знайти музику</Link></div>}
      {next && <div className="media-load-more"><Button variant="secondary" disabled={loading || deleting} onClick={() => { void loadMore(); }}>{loading ? 'Завантаження…' : 'Завантажити ще'}</Button></div>}
    </div>
    {notice && <p className="media-feedback media-toast" role="status">{notice}<button aria-label="Закрити повідомлення" onClick={() => setNotice('')}><MediaIcon name="remove" width="16" height="16" /></button></p>}
    <Dialog open={confirm !== null} onClose={() => { if (!deleting) setConfirm(null); }} title={confirm === 'all' ? 'Очистити мою історію?' : 'Видалити запис?'} description={confirm === 'all' ? 'Усі записи про додані вами треки буде видалено з історії цього сервера. Записи інших учасників залишаться. Цю дію неможливо скасувати.' : 'Цей запис буде видалено з історії цього сервера. Цю дію неможливо скасувати.'} footer={<><Button variant="secondary" disabled={deleting} onClick={() => setConfirm(null)}>Скасувати</Button><Button variant="danger" disabled={deleting} onClick={() => { void remove(); }}>{deleting ? 'Видалення…' : confirm === 'all' ? 'Очистити мою історію' : 'Видалити запис'}</Button></>}>
      {confirm && confirm !== 'all' && <div className="media-history-confirm-track"><MediaArtwork track={confirm.track} /><div className="media-track-info"><strong>{confirm.track.title}</strong><span>{confirm.track.artist}</span></div></div>}
      {deleting && <p role="status">{deletedCount ? `Видалено записів: ${deletedCount}…` : 'Видалення записів…'}</p>}
      {deleteError && <p className="media-feedback is-error" role="alert">{deleteError}</p>}
    </Dialog>
  </section>;
}
