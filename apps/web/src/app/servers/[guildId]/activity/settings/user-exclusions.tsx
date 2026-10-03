'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { directoryMemberSchema, type DirectoryMember } from '@scrt/validation';

export function UserExclusions({ guildId, selected, editable }: { guildId: string; selected: Array<{ userId: string; displayName: string }>; editable: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryMember[]>([]);
  const [users, setUsers] = useState(selected);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const selectedFields = useRef<HTMLDivElement>(null);
  const names = useRef(new Map(selected.map((user) => [user.userId, user.displayName])));
  const previousIds = useRef(selected.map((user) => user.userId).join(','));
  const id = useId();
  useEffect(() => {
    const form = root.current?.closest('form');
    const reset = (event: Event) => { const data = (event as CustomEvent<FormData>).detail; const ids = data.getAll('userIds').map(String); previousIds.current = ids.join(','); setUsers(ids.map((userId) => ({ userId, displayName: names.current.get(userId) ?? 'Учасник більше недоступний' }))); setQuery(''); };
    form?.addEventListener('scrt:reset', reset);
    return () => form?.removeEventListener('scrt:reset', reset);
  }, []);
  useEffect(() => {
    users.forEach((user) => names.current.set(user.userId, user.displayName));
    const ids = users.map((user) => user.userId).join(',');
    if (ids !== previousIds.current) { previousIds.current = ids; selectedFields.current?.dispatchEvent(new Event('input', { bubbles: true })); }
  }, [users]);
  useEffect(() => {
    if (!editable || query.trim().length < 2) { setResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/guilds/${guildId}/activity/member-search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Пошук Discord недоступний. Спробуйте повний ID учасника.');
        const data: unknown = await response.json();
        const members = typeof data === 'object' && data !== null && 'members' in data ? data.members : null;
        const parsed = directoryMemberSchema.array().parse(members);
        if (!controller.signal.aborted) { setResults(parsed); setError(''); }
      } catch (failure) { if (!controller.signal.aborted) { setResults([]); setError(failure instanceof Error ? failure.message : 'Пошук недоступний.'); } }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, guildId, editable]);
  return <div ref={root} className="user-exclusions"><label htmlFor={id} className="field-label">Виключені учасники</label><div ref={selectedFields} className="resource-chips">{users.map((user) => <span className="resource-chip" key={user.userId}><input type="hidden" name="userIds" value={user.userId} />{user.displayName}{editable && <button type="button" aria-label={`Прибрати: ${user.displayName}`} onClick={() => setUsers((current) => current.filter((item) => item.userId !== user.userId))}>×</button>}</span>)}{!users.length && <span className="field-help">Немає виключених учасників.</span>}</div>{editable && <input id={id} type="search" className="ui-input" maxLength={50} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук за ім’ям або ID…" autoComplete="off" />}{error && <p className="field-error" role="alert">{error}</p>}{editable && query.trim().length >= 2 && <ul className="member-search-results">{results.filter((member) => !users.some((user) => user.userId === member.id)).map((member) => <li key={member.id}><button className="member-search-choice" type="button" onClick={() => { setUsers((current) => [...current, { userId: member.id, displayName: member.nick ?? member.globalName ?? member.username }]); setQuery(''); }}>+ {member.nick ?? member.globalName ?? member.username}</button></li>)}</ul>}</div>;
}
