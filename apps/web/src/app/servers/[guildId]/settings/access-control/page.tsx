import { requireGuildAccess } from '@/lib/guards';
import { permissionsForRole } from '@scrt/permissions';

export default async function AccessControl({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { ownerId, mappings } = await requireGuildAccess(guildId, 'settings.view');
  return <>
    <h2 className="text-3xl font-semibold">Access Control</h2>
    <p className="mt-4 text-slate-400">The Discord server owner always has Super Admin access. Role mapping editing is coming later.</p>
    <div className="mt-8 rounded-xl border border-slate-700 bg-slate-900 p-5">
      <div className="text-sm text-slate-400">Server owner · Super Admin</div>
      <div className="mt-2 font-mono text-sm">{ownerId}</div>
      <p className="mt-3 text-sm text-slate-400">{permissionsForRole('SUPER_ADMIN').join(' · ')}</p>
    </div>
    <h3 className="mt-8 text-xl font-medium">Discord role mappings</h3>
    {mappings.length ? <ul className="mt-4 space-y-3">{mappings.map((mapping) => <li key={mapping.discordRoleId} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><span className="font-mono text-sm">{mapping.discordRoleId}</span><span className="ml-4 text-indigo-300">{mapping.appRole}</span><p className="mt-3 text-sm text-slate-400">{permissionsForRole(mapping.appRole).join(' · ')}</p></li>)}</ul> : <p className="mt-3 text-slate-400">No role mappings configured.</p>}
  </>;
}
