'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { runtimeLogResponseSchema, type RuntimeLogResponse } from '@scrt/validation';

export function RuntimeLogs({ active = true }: { active?: boolean }) {
  const [data, setData] = useState<RuntimeLogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [source, setSource] = useState('all');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const current = useRef<RuntimeLogResponse | null>(null);
  useEffect(() => {
    if (paused || !active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let delay = 5000;
      try {
        const params = new URLSearchParams();
        for (const origin of ['bot', 'web'] as const) { const session = current.current?.[origin]; if (session) { params.set(`${origin}Run`, session.runId); params.set(`${origin}After`, String(session.entries.at(-1)?.sequence ?? 0)); } }
        const response = await fetch(`/api/admin/logs?${params}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          if ((response.status === 401 || response.status === 403) && !controller.signal.aborted) { current.current = null; setData(null); }
          throw new Error(response.status === 401 ? 'Сесія завершилася. Увійдіть знову.' : response.status === 403 ? 'Доступ заборонено.' : 'Не вдалося оновити логи.');
        }
        const value = runtimeLogResponseSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          for (const origin of ['bot', 'web'] as const) {
            const next = value[origin]; const previous = current.current?.[origin];
            if (!next) { if (origin === 'bot' && previous) value.bot = previous; continue; }
            if (next.entries.length === 500) delay = 250;
            if (previous?.runId === next.runId) next.entries = [...previous.entries.filter((entry) => entry.sequence > next.dropped), ...next.entries].slice(-5000);
          }
          current.current = value; setData(value); setError(null); setUpdatedAt(new Date().toLocaleTimeString('uk-UA'));
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Логи недоступні.'); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, delay); }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [paused, active]);
  const entries = useMemo(() => data ? (['bot', 'web'] as const).flatMap((origin) => (data[origin]?.entries ?? []).map((entry) => ({ ...entry, origin, runId: data[origin]!.runId }))).sort((a, b) => b.time.localeCompare(a.time) || b.sequence - a.sequence) : [], [data]);
  const filtered = entries.filter((entry) => (level === 'all' || entry.level === level) && (source === 'all' || entry.origin === source) && `${entry.message} ${entry.stack ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  function download() {
    const url = URL.createObjectURL(new Blob([filtered.map((entry) => JSON.stringify(entry)).join('\n')], { type: 'application/x-ndjson' }));
    const link = document.createElement('a'); link.href = url; link.download = 'scrt-runtime-logs.jsonl'; link.click(); URL.revokeObjectURL(url);
  }
  return <>
    <div className="runtime-log-toolbar">
      <label>Пошук<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Трек, сервер, подія або помилка" /></label>
      <label>Рівень<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">Усі рівні</option><option value="error">Помилки</option><option value="warn">Попередження</option><option value="info">Інформація</option></select></label>
      <label>Процес<select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">Бот і веб</option><option value="bot">Бот</option><option value="web">Веб</option></select></label>
      <button type="button" onClick={() => setPaused(!paused)}>{paused ? 'Відновити оновлення' : 'Призупинити оновлення'}</button>
      <button type="button" disabled={!filtered.length} onClick={download}>Завантажити JSONL</button>
    </div>
    <p role="status" className="muted runtime-log-status">{paused ? 'Оновлення призупинено' : updatedAt ? `Оновлено о ${updatedAt} · кожні 5 секунд` : 'Завантаження…'} · Записів: {filtered.length}</p>
    {error && <p role="alert" className="runtime-log-warning">{error}</p>}
    {data?.botError && <p role="alert" className="runtime-log-warning">{data.botError}</p>}
    {data && <details className="runtime-log-sessions"><summary>Інформація про запуск</summary>{(['bot', 'web'] as const).map((origin) => { const session = data[origin]; return session && <div key={origin}><strong>{origin === 'bot' ? 'Бот' : 'Веб'}</strong><span>Запуск: {new Date(session.startedAt).toLocaleString('uk-UA')}</span><code>{session.runId}</code><span>Витіснено старих записів: {session.dropped}</span></div>; })}</details>}
    <p className="muted runtime-log-buffer">Лише пам’ять поточного запуску · до 5000 записів / 8 МіБ на процес. Секрети та адреси джерел приховано.</p>
    <div className="runtime-log-list" aria-label="Події поточного запуску">
      {!filtered.length && data && <p className="muted">Подій за цими фільтрами немає.</p>}
      {filtered.slice(0, 500).map((entry) => <details className="runtime-log-entry" data-level={entry.level} key={`${entry.origin}:${entry.runId}:${entry.sequence}`}><summary><time dateTime={entry.time}>{new Date(entry.time).toLocaleTimeString('uk-UA')}</time><span className="runtime-log-level">{entry.level}</span><span className="muted">{entry.origin}</span><span>{entry.message}</span></summary><pre>{JSON.stringify(entry.context, null, 2)}{entry.stack ? `\n\n${entry.stack}` : ''}</pre></details>)}
      {filtered.length > 500 && <p className="muted">Показано 500 найновіших подій. Уточніть пошук або завантажте всі відфільтровані записи.</p>}
    </div>
  </>;
}
