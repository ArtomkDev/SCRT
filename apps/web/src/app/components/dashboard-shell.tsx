import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { requireSession } from '@/lib/guards';
import { DashboardNav } from './dashboard-nav';
import { UnsavedChangesProvider } from './unsaved-changes';

export async function DashboardShell({ children }: { children: ReactNode }) {
  const { user } = await requireSession();
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'webp'}?size=64` : null;
  return <UnsavedChangesProvider><div className="app-shell">
    <header className="topbar"><Link className="brand" href="/servers">SCRT <span>CONTROL</span></Link><div className="profile">{avatar ? <Image src={avatar} alt="Аватар користувача" width={28} height={28} unoptimized /> : <span className="profile-fallback" aria-hidden="true">{user.username[0]?.toUpperCase()}</span>}<span className="profile-name">{user.global_name || user.username}</span><form action="/api/auth/logout" method="post"><button type="submit" className="logout">Вийти</button></form></div></header>
    <div className="shell-body"><aside className="global-sidebar"><span className="sidebar-label">Робоча область</span><DashboardNav /></aside><div className="shell-content">{children}</div></div>
  </div></UnsavedChangesProvider>;
}
