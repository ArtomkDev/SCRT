import type { ReactNode } from 'react';
import { requireGuildAccess } from '@/lib/guards';
import { VoiceTabs } from '../../../components/voice-tabs';

export default async function VoiceLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireGuildAccess(guildId, 'voice.view');
  return <main className="content-page"><div className="page-heading"><h1>Голосові канали</h1><p>Тимчасові кімнати та канали створення.</p></div><VoiceTabs guildId={guildId} />{children}</main>;
}
