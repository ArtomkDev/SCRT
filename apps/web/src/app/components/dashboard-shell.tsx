import Link from 'next/link';
import Image from 'next/image';
import { Suspense, type ReactNode } from 'react';
import { requireSession } from '@/lib/guards';
import { isRuntimeLogAdmin } from '@scrt/permissions';
import { isDevelopment } from '@/lib/application-environment';
import { AppBrand, AppMark } from './app-brand';
import { GuildNavigationData } from './guild-navigation-data';
import { PrefetchLink } from './prefetch-link';
import { UnsavedChangesProvider } from './unsaved-changes';
import { DataBoundary } from './data-boundary';
import { RuntimeLogsButton, RuntimeLogsProvider, RuntimeLogsWorkspace } from './runtime-logs/runtime-logs-panel';
import { DashboardMediaProvider } from './media-player/media-player-context';
import { MediaPlayerButton, MediaPlayerHeaderGlow } from './media-player/media-player-dock';

async function SessionProfile() {
  const { user } = await requireSession();
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'webp'}?size=64` : null;
  return <div className="profile">{isRuntimeLogAdmin(user.id) && <RuntimeLogsButton />}{avatar ? <Image src={avatar} alt="Аватар користувача" width={28} height={28} unoptimized /> : <span className="profile-fallback" aria-hidden="true">{user.username[0]?.toUpperCase()}</span>}<span className="profile-name">{user.global_name || user.username}</span><form action="/api/auth/logout" method="post"><button type="submit" className="logout">Вийти</button></form></div>;
}
export function DashboardShell({ children }: { children: ReactNode }) {
  return <RuntimeLogsProvider><DashboardMediaProvider><UnsavedChangesProvider><div className="app-shell">
    <header className="topbar"><MediaPlayerHeaderGlow /><Link className="brand" href="/servers"><AppBrand development={isDevelopment} /></Link><div className="topbar-tools"><MediaPlayerButton /><DataBoundary title="Профіль недоступний" compact><Suspense fallback={<span className="profile-loading muted" role="status">Завантаження профілю…</span>}><SessionProfile /></Suspense></DataBoundary></div></header>
    <RuntimeLogsWorkspace><div className="shell-body"><Suspense fallback={<>
      <nav className="guild-rail" aria-label="Перемикання серверів" aria-busy="true"><PrefetchLink href="/servers" className="guild-rail-item guild-rail-home" aria-label="Усі сервери"><AppMark development={isDevelopment} /></PrefetchLink><span className="guild-rail-separator" aria-hidden="true" /><span className="visually-hidden" role="status">Завантаження серверів…</span>{[0, 1, 2].map((key) => <span key={key} className="skeleton guild-rail-skeleton" aria-hidden="true" />)}</nav>
      <div className="mobile-guild-switcher mobile-guild-loading" role="status">Завантаження серверів…</div>
    </>}><GuildNavigationData development={isDevelopment} /></Suspense><div className="shell-content">{children}</div></div></RuntimeLogsWorkspace>
  </div></UnsavedChangesProvider></DashboardMediaProvider></RuntimeLogsProvider>;
}
