'use server';

import { revalidatePath } from 'next/cache';
import { botGuild, botGuildMember, botGuildRoles } from '@scrt/discord';
import { guildIdSchema, snowflakeSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { env, guilds } from '@/lib/server';

async function requireEditor(rawGuildId: string) {
  const guildId = guildIdSchema.parse(rawGuildId);
  const { accessActor } = await requireGuildAccess(guildId, 'settings.manage');
  return { guildId, actor: accessActor };
}

export async function saveAccessRole(rawGuildId: string, form: FormData): Promise<void> {
  const { guildId, actor } = await requireEditor(rawGuildId);
  const roleId = snowflakeSchema.parse(form.get('roleId'));
  const appRole = form.get('appRole');
  if (appRole !== 'SUPER_ADMIN' && appRole !== 'ADMIN' && appRole !== 'VIEWER') throw new Error('Invalid access level');
  if (roleId === guildId && appRole !== 'VIEWER') throw new Error('@everyone supports viewing only');
  const roles = await botGuildRoles(env().DISCORD_BOT_TOKEN, guildId);
  if (!roles.some((role) => role.id === roleId)) throw new Error('Invalid Discord role');
  await guilds().setRoleMapping(guildId, roleId, appRole, actor);
  revalidatePath(`/servers/${guildId}`, 'layout');
}

export async function removeAccessRole(rawGuildId: string, form: FormData): Promise<void> {
  const { guildId, actor } = await requireEditor(rawGuildId);
  const roleId = snowflakeSchema.parse(form.get('roleId'));
  await guilds().removeRoleMapping(guildId, roleId, actor);
  revalidatePath(`/servers/${guildId}`, 'layout');
}

export async function saveAccessMember(rawGuildId: string, form: FormData): Promise<void> {
  const { guildId, actor } = await requireEditor(rawGuildId);
  const userId = snowflakeSchema.parse(form.get('userId'));
  const appRole = form.get('appRole');
  if (appRole !== 'SUPER_ADMIN' && appRole !== 'ADMIN' && appRole !== 'VIEWER') throw new Error('Invalid access level');
  const token = env().DISCORD_BOT_TOKEN;
  const [guild, member] = await Promise.all([botGuild(token, guildId), botGuildMember(token, guildId, userId)]);
  if (userId === guild.owner_id || member.user.id !== userId || member.user.bot) throw new Error('Invalid access member');
  await guilds().setMemberMapping(guildId, userId, appRole, actor);
  revalidatePath(`/servers/${guildId}`, 'layout');
}

export async function removeAccessMember(rawGuildId: string, form: FormData): Promise<void> {
  const { guildId, actor } = await requireEditor(rawGuildId);
  const userId = snowflakeSchema.parse(form.get('userId'));
  await guilds().removeMemberMapping(guildId, userId, actor);
  revalidatePath(`/servers/${guildId}`, 'layout');
}
