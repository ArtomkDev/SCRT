'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { DirectoryMember } from '@scrt/validation';
import type { AccessMappings } from '@scrt/permissions';
import { ActionForm } from '@/app/components/action-form';
import { directoryJson, readDirectoryMembers, useMemberDirectory } from './member-directory';
import { highlightedParts, memberAccessLabels, memberAccessLevels, memberSearchIndex, searchMemberIndex } from './member-search-utils';

const limit = 30;

function Highlight({ text, query }: { text: string; query: string }) {
  return <>{highlightedParts(text, query).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</>;
}

export function MemberSearch({ guildId, ownerId, mappings, action }: {
  guildId: string; ownerId: string; mappings: AccessMappings; action: (data: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const { members, mode, loaded, retry } = useMemberDirectory();
  const [remote, setRemote] = useState<DirectoryMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const assigned = useMemo(() => new Set([ownerId, ...mappings.members.map((mapping) => mapping.discordUserId)]), [ownerId, mappings.members]);
  const baseUrl = `/api/guilds/${guildId}/members`;

  useEffect(() => {
    if (mode !== 'fallback' || query.trim().length < 2) { setRemote([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const data = await directoryJson(await fetch(`${baseUrl}?query=${encodeURIComponent(query.trim().slice(0, 50))}`, { cache: 'no-store', signal: controller.signal }));
        setRemote(readDirectoryMembers(data));
      } catch { if (!controller.signal.aborted) setRemote([]); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [baseUrl, mode, query]);

  const searchSource = mode === 'fallback' ? remote : members;
  const index = useMemo(() => memberSearchIndex(searchSource), [searchSource]);
  const levels = useMemo(() => memberAccessLevels(guildId, ownerId, searchSource, mappings), [guildId, ownerId, searchSource, mappings]);
  const result = useMemo(() => searchMemberIndex(index, deferredQuery, levels), [index, deferredQuery, levels]);
  const selected = result.matches.find((member) => member.id === selectedId && !assigned.has(member.id));
  return <section className="detail-panel access-role-editor"><h2>Надати доступ учаснику</h2>
    <p className="muted">Знайдіть учасника за ніком, іменем користувача або ID Discord.</p>
    <p className="muted">Учасники з доступом — наприкінці результатів. Їхні персональні права можна змінити у списку вище.</p>
    <label className="member-search-label">Пошук учасника<input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }} maxLength={50} placeholder="Нік, ім’я користувача або ID" autoComplete="off" /></label>
    {mode === 'loading' && <p className="muted" role="status">Завантаження учасників… {loaded > 0 ? `Отримано ${loaded.toLocaleString('uk-UA')}` : ''}</p>}
    {mode === 'error' && <p className="form-feedback form-feedback-error" role="alert">Не вдалося завантажити учасників. <button type="button" className="action-link" onClick={retry}>Повторити</button></p>}
    {mode === 'fallback' && <p className="form-feedback" role="status">Повний список недоступний. Шукайте за початком імені або повним ID. Для повного списку увімкніть Server Members Intent у налаштуваннях бота в Discord.</p>}
    {mode === 'directory' && <p className="muted member-search-count">Учасників у списку: {members.length.toLocaleString('uk-UA')}</p>}
    {query.trim() && mode !== 'error' && (mode !== 'loading' || members.length > 0) && <>
      {mode === 'fallback' && query.trim().length < 2 ? <p className="muted">Введіть щонайменше 2 символи.</p> : <p className="muted" role="status">Знайдено: {result.total}{result.total > limit ? ` · показано перші ${limit}` : ''}</p>}
      <ul className="member-search-results">{result.matches.map((member) => <li key={member.id}><button type="button" disabled={assigned.has(member.id)} className={selected?.id === member.id ? 'member-search-choice member-search-choice-selected' : 'member-search-choice'} onClick={() => setSelectedId(member.id)}>
        <Image src={member.avatarUrl} alt="" width={36} height={36} unoptimized />
        <span className="member-search-names"><strong><Highlight text={member.nick ?? member.globalName ?? member.username} query={deferredQuery} /></strong>
          {member.nick && member.globalName && <small><Highlight text={member.globalName} query={deferredQuery} /></small>}
          <small>@<Highlight text={member.username} query={deferredQuery} /></small>
          {levels.has(member.id) && <span className="member-search-access">{memberAccessLabels[levels.get(member.id)!]}</span>}
        </span><code><Highlight text={member.id} query={deferredQuery} /></code>
      </button></li>)}</ul>
      {mode === 'directory' && result.total === 0 && <p className="empty-state">Учасників не знайдено.</p>}
    </>}
    {selected && <ActionForm trackChanges={false} key={selected.id} action={action} className="access-role-update member-search-grant" successMessage="Доступ надано." feedbackPlacement="toast"><input type="hidden" name="userId" value={selected.id} /><label>Рівень доступу<select name="appRole" defaultValue="ADMIN"><option value="SUPER_ADMIN">Повний доступ</option><option value="ADMIN">Налаштування бота</option><option value="VIEWER">Лише перегляд</option></select></label><button type="submit" className="action-link">Надати доступ</button></ActionForm>}
  </section>;
}
