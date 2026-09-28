import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireGuildAccess } from '@/lib/guards';

const sections = [['Overview', ''], ['Members', '/members'], ['Activity', '/activity'], ['Voice', '/voice'], ['Moderation', '/moderation'], ['Automation', '/automation'], ['Logs', '/logs'], ['Settings', '/settings'], ['Access Control', '/settings/access-control']] as const;
export default async function GuildLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { guild } = await requireGuildAccess(guildId);
  return <div className="min-h-screen md:flex"><aside className="w-full border-b border-slate-700 bg-slate-900 p-6 md:min-h-screen md:w-64 md:border-b-0 md:border-r"><Link href="/servers" className="text-sm text-indigo-400">← Servers</Link><h1 className="mt-7 truncate text-xl font-semibold">{guild.name}</h1><nav aria-label="Server sections" className="mt-8 flex flex-wrap gap-1 md:flex-col">{sections.map(([name, suffix]) => <Link key={name} href={`/servers/${guildId}${suffix}`} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">{name}</Link>)}</nav></aside><main className="flex-1 p-8">{children}</main></div>;
}
