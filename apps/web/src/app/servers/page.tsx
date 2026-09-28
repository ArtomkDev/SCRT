import Link from 'next/link';
import { manageableGuilds } from '@/lib/guards';
import { env, guilds } from '@/lib/server';
import { installUrl } from '@scrt/discord';

export default async function Servers() {
  const list = await manageableGuilds();
  const records = await Promise.all(list.map((guild) => guilds().get(guild.id)));
  return <main className="mx-auto max-w-5xl p-8"><header className="flex items-center justify-between"><div><div className="text-sm font-bold tracking-[.2em] text-indigo-400">SCRT CONTROL</div><h1 className="mt-3 text-3xl font-semibold">Your servers</h1></div><form action="/api/auth/logout" method="post"><button className="text-slate-400 hover:text-white">Log out</button></form></header><p className="mt-3 text-slate-400">Servers where you have Manage Server permission.</p>{list.length === 0 ? <div className="mt-10 rounded-xl border border-slate-700 p-8 text-slate-400">No manageable servers were returned by Discord.</div> : <div className="mt-8 grid gap-4 sm:grid-cols-2">{list.map((guild, index) => { const installed = records[index]?.botInstalled; return <article key={guild.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-6"><h2 className="text-xl font-semibold">{guild.name}</h2><p className="mt-1 text-sm text-slate-400">{installed ? 'Bot installed' : 'Bot not installed'}</p><Link className="mt-5 inline-block rounded-lg bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400" href={installed ? `/servers/${guild.id}` : installUrl(env().DISCORD_CLIENT_ID, guild.id)}>{installed ? 'Manage' : 'Add Bot'}</Link></article>; })}</div>}</main>;
}
