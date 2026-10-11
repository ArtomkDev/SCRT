'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { MediaIcon } from '@/app/servers/[guildId]/media/media-icon';
import { MediaPlaybackPanel } from '@/app/servers/[guildId]/media/player-panel';
import { useMediaPlayerWorkspace } from './media-player-context';
import './media-player.css';

function connectionStatus(controller: { pending: readonly unknown[]; unavailable: string | null } | undefined) {
  const state = controller?.pending.length ? 'pending' : !controller ? 'connecting' : controller.unavailable ? 'offline' : 'ready';
  return { state, label: { pending: 'Синхронізація…', connecting: 'Підключення…', offline: 'Немає з’єднання', ready: 'Синхронізовано' }[state] };
}

export function MediaPlayerButton() {
  const workspace = useMediaPlayerWorkspace();
  if (!workspace?.scope) return null;
  const controller = workspace.binding?.controller;
  const track = controller?.snapshot.session?.currentTrack;
  const status = connectionStatus(controller);
  return <button ref={workspace.trigger} type="button" className="logout media-player-toggle" aria-label="Плеєр" aria-expanded={workspace.open} aria-controls={workspace.id} onClick={workspace.toggle} title={`${track?.title ?? 'Плеєр'} · ${workspace.scope.guildName} · ${status.label}`}><MediaIcon name="music" width="15" height="15" /><span>Плеєр</span><i data-status={status.state} aria-hidden="true" /></button>;
}
export function MediaPlayerHeaderGlow() {
  const workspace = useMediaPlayerWorkspace();
  return <span className="media-player-header-glow" aria-hidden="true" data-open={workspace?.open ?? false} style={workspace?.ambienceStyle} />;
}
export function MediaPlayerDock() {
  const workspace = useMediaPlayerWorkspace();
  const dock = useRef<HTMLElement>(null);
  useEffect(() => {
    if (workspace?.open && window.matchMedia?.('(max-width: 800px)').matches) dock.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }, [workspace?.open]);
  if (!workspace?.scope) return null;
  const { scope, open, id, close, setPalette, ambienceStyle } = workspace;
  const controller = workspace.binding?.controller;
  const status = connectionStatus(controller);
  return <aside ref={dock} id={id} className="media-player-dock" aria-label="Панель плеєра" aria-hidden={!open} inert={!open} onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); close(); } }}>
    <div className="media-player-dock-panel">
      <span className="media-player-dock-background" aria-hidden="true" style={ambienceStyle} />
      <header className="media-player-dock-header"><h2>Плеєр</h2><span className={`media-sync is-${status.state}`} role="status">{status.label}</span></header>
      <div className="media-player-dock-body"><MediaPlaybackPanel key={`${scope.guildId}:${scope.userId}`} guildId={scope.guildId} initial={scope.initial} initialError={scope.initialError} active={open} onPalette={setPalette} /></div>
      <nav className="media-player-dock-links" aria-label="Розділи музики"><Link href={`/servers/${scope.guildId}/media`}><MediaIcon name="queue" width="15" height="15" />Пошук і черга</Link><Link href={`/servers/${scope.guildId}/media/favorites`}><MediaIcon name="heart" width="15" height="15" />Улюблені</Link><Link href={`/servers/${scope.guildId}/media/history`}><MediaIcon name="history" width="15" height="15" />Історія</Link></nav>
    </div>
  </aside>;
}
