'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { guildAction, type ManageableGuild } from '@/lib/guild-presentation';
import { AppMark } from './app-brand';
import { GuildIcon } from './guild-icon';
import { NavigationIcon } from './navigation-icon';
import { PrefetchLink } from './prefetch-link';
import { Tooltip } from './tooltip';

type GuildGroups = { installed: ManageableGuild[]; available: ManageableGuild[] };
type NavigationProps = { groups: GuildGroups; development?: boolean; unavailable?: boolean };

function AddGuildLink({ guild, compact = false, 'aria-describedby': describedBy }: { guild: ManageableGuild; compact?: boolean; 'aria-describedby'?: string }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return <a href={guildAction(guild).href} className={compact ? 'guild-rail-item guild-rail-add' : 'guild-picker-item guild-picker-add'}
    aria-label={`Додати SCRT до сервера ${guild.name}`} aria-disabled={pending || undefined} aria-busy={pending || undefined}
    aria-describedby={describedBy}
    onClick={(event) => {
      if (pending) { event.preventDefault(); return; }
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setPending(true);
    }}>
    <span className="guild-rail-visual"><GuildIcon {...guild} size={compact ? 44 : 32} /><span className="guild-add-overlay"><NavigationIcon kind="plus" width="24" height="24" /></span><span className="guild-add-hint" aria-hidden="true">+</span></span>
    {!compact && <span className="guild-picker-copy"><strong>{guild.name}</strong><small>{pending ? 'Відкриваємо Discord…' : 'Додати SCRT'}</small></span>}
  </a>;
}

function GuildRail({ groups, selectedId, development, unavailable, retry, pending }: NavigationProps & { selectedId?: string; retry: () => void; pending: boolean }) {
  return <nav className="guild-rail" aria-label="Перемикання серверів">
    <Tooltip label="Усі сервери"><PrefetchLink href="/servers" className="guild-rail-item guild-rail-home" aria-label="Усі сервери" aria-current={!selectedId ? 'page' : undefined}><AppMark development={development} /></PrefetchLink></Tooltip>
    <span className="guild-rail-separator" aria-hidden="true" />
    {groups.installed.map((guild) => <Tooltip key={guild.id} label={guild.name}><PrefetchLink href={guildAction(guild).href} className="guild-rail-item" aria-label={guild.name} aria-current={selectedId === guild.id ? 'page' : undefined}><GuildIcon {...guild} size={44} /></PrefetchLink></Tooltip>)}
    {groups.available.length > 0 && <span className="guild-rail-separator" aria-hidden="true" />}
    {groups.available.map((guild) => <Tooltip key={guild.id} label={`Додати SCRT до ${guild.name}`}><AddGuildLink guild={guild} compact /></Tooltip>)}
    {unavailable && <>
      {selectedId && !groups.installed.some((guild) => guild.id === selectedId) && <Tooltip label="Поточний сервер"><PrefetchLink href={`/servers/${selectedId}`} className="guild-rail-item" aria-label="Поточний сервер" aria-current="page"><GuildIcon id={selectedId} name="Поточний сервер" icon={null} size={44} /></PrefetchLink></Tooltip>}
      <Tooltip label="Не вдалося завантажити сервери. Спробувати ще раз"><button type="button" className="guild-rail-item guild-rail-retry" aria-label="Повторити завантаження серверів" onClick={retry} disabled={pending}><NavigationIcon kind="retry" /></button></Tooltip>
    </>}
  </nav>;
}

function MobileGuildSwitcher({ groups, selectedId, unavailable, retry, pending }: NavigationProps & { selectedId?: string; retry: () => void; pending: boolean }) {
  const picker = useRef<HTMLDetailsElement>(null);
  const selected = groups.installed.find((guild) => guild.id === selectedId);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !picker.current?.contains(event.target) && picker.current) picker.current.open = false; };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return <details className="mobile-guild-switcher" ref={picker} onKeyDown={(event) => {
    if (event.key === 'Escape' && picker.current?.open) { picker.current.open = false; picker.current.querySelector('summary')?.focus(); }
  }}>
    <summary>{selected && <GuildIcon {...selected} size={28} />}<span>{selected?.name ?? (selectedId ? 'Поточний сервер' : 'Усі сервери')}</span><NavigationIcon kind="chevron-down" /></summary>
    <nav className="guild-picker" aria-label="Сервери" onClick={(event) => { if (!event.defaultPrevented && (event.target as Element).closest('a') && picker.current) picker.current.open = false; }}>
      <PrefetchLink href="/servers" className="guild-picker-item">Усі сервери</PrefetchLink>
      {unavailable ? <div className="guild-picker-error"><p role="status">Не вдалося завантажити сервери.</p><button type="button" className="secondary-button" onClick={retry} disabled={pending}>Спробувати ще раз</button></div> : <>
        <span className="sidebar-label">Підключені</span>
        {groups.installed.map((guild) => <PrefetchLink key={guild.id} href={guildAction(guild).href} className="guild-picker-item" aria-current={selectedId === guild.id ? 'page' : undefined}><GuildIcon {...guild} size={32} /><span className="guild-picker-copy"><strong>{guild.name}</strong><small>SCRT підключено</small></span></PrefetchLink>)}
        {!groups.installed.length && <p className="guild-picker-empty">Немає підключених серверів.</p>}
        {groups.available.length > 0 && <span className="sidebar-label">Доступні для підключення</span>}
        {groups.available.map((guild) => <AddGuildLink key={guild.id} guild={guild} />)}
      </>}
    </nav>
  </details>;
}

export function GuildNavigation(props: NavigationProps) {
  const pathname = usePathname();
  const selectedId = pathname.match(/^\/servers\/(\d{17,20})(?:\/|$)/u)?.[1];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const shared = { ...props, selectedId, pending, retry: () => startTransition(() => router.refresh()) };
  return <><GuildRail {...shared} /><MobileGuildSwitcher key={selectedId ?? 'all'} {...shared} /></>;
}
