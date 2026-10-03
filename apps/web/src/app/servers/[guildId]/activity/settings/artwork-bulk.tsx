'use client';
import { useRef, useState, useTransition } from 'react';
import { enrichMissingArtworkBatch } from '../artwork-actions';

export function ArtworkBulk({ guildId }: { guildId: string }) {
  const [pending, start] = useTransition();
  const running = useRef(false);
  const [result, setResult] = useState('');
  function enrich() {
    if (running.current) return;
    running.current = true;
    start(async () => {
      let cursor: string | null = null;
      let scanned = 0; let resolved = 0; let fallback = 0; let skipped = 0; let errors = 0;
      try {
        do {
          const batch = await enrichMissingArtworkBatch(guildId, cursor);
          scanned += batch.scanned; resolved += batch.resolved; fallback += batch.fallback; skipped += batch.skipped; errors += batch.errors;
          cursor = batch.next;
          setResult(`Перевірено: ${scanned}. Знайдено: ${resolved}. Резервне оформлення: ${fallback}. Кеш / ручний вибір: ${skipped}. Помилки: ${errors}.`);
        } while (cursor);
      } catch { setResult('Оновлення перервано. Уже отримане оформлення збережено; спробуйте ще раз.'); }
      finally { running.current = false; }
    });
  }
  return <div><button type="button" className="secondary-button" disabled={pending} onClick={enrich}>{pending ? 'Оновлення оформлення…' : 'Оновити відсутнє оформлення'}</button><p className="field-help" role="status">{result || 'Оновлює відсутні зображення. Ручний вибір і свіжий кеш зберігаються.'}</p></div>;
}
