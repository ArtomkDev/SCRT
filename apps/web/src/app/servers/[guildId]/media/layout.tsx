import type { ReactNode } from 'react';
import { requireGuildAccess } from '@/lib/guards';
import { MediaHeader } from './media-header';
import { DashboardScreen } from '@/app/components/dashboard-screen';

export default async function MediaLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params; await requireGuildAccess(guildId, 'media.view');
  return <DashboardScreen width="wide" className="media-content" contentClassName="media-page" header={<MediaHeader guildId={guildId} />}>{children}</DashboardScreen>;
}
