'use server';
import { revalidatePath } from 'next/cache';
import { botGuildChannels, botGuildMember, botGuildRoles } from '@scrt/discord';
import { activityGameKeySchema, activitySettingsSchema } from '@scrt/validation';
import { requireGuildAccess } from '@/lib/guards';
import { activity, env } from '@/lib/server';

export async function saveActivitySettings(guildId: string, form: FormData): Promise<void> {
  const access = await requireGuildAccess(guildId, 'activity.manage');
  const check = (key: string) => form.get(key) === 'on';
  const list = (key: string) => form.getAll(key).map(String);
  const number = (key: string) => Number(form.get(key));
  const returnGrace = form.get('voiceReturnGrace');
  const parsed = activitySettingsSchema.safeParse({
    enabled: check('enabled'), tracking: { messages: check('messages'), voice: check('voice'), streaming: check('streaming'), games: check('games'), voiceStreaks: check('voiceStreaks') },
    exclusions: { channelIds: list('channelIds'), categoryIds: list('categoryIds'), roleIds: list('roleIds'), userIds: list('userIds'), ignoreBots: true, ignoreAfkChannel: check('ignoreAfkChannel') },
    voice: { minimumSessionSeconds: number('voiceMinimum'), returnGraceSeconds: returnGrace === null ? undefined : typeof returnGrace === 'string' && returnGrace.trim() ? Number(returnGrace) : NaN }, streaming: { minimumSessionSeconds: number('streamMinimum') }, games: { minimumSessionSeconds: number('gameMinimum') },
    streak: { timezone: String(form.get('timezone') ?? ''), minimumVoiceSecondsPerDay: number('streakMinimum') }, schemaVersion: 1,
  });
  if (!parsed.success) throw new Error('Перевірте часовий пояс, виключення та пороги тривалості (1–86400 секунд; час на повернення — 0–86400).');
  const value = parsed.data;
  const token = env().DISCORD_BOT_TOKEN;
  const [channels, roles, previous] = await Promise.all([botGuildChannels(token, guildId), botGuildRoles(token, guildId), activity().getSettings(guildId)]);
  if (returnGrace === null) value.voice.returnGraceSeconds = previous.voice.returnGraceSeconds;
  if (value.exclusions.channelIds.some((id) => !channels.some((channel) => channel.id === id && channel.type !== 4)) || value.exclusions.categoryIds.some((id) => !channels.some((channel) => channel.id === id && channel.type === 4))) throw new Error('Виключений канал має належати цьому серверу.');
  if (value.exclusions.roleIds.some((id) => !roles.some((role) => role.id === id))) throw new Error('Виключена роль має належати цьому серверу.');
  // Existing exclusions may refer to former members. Newly submitted users must be live guild members.
  for (const userId of value.exclusions.userIds.filter((id) => !previous.exclusions.userIds.includes(id))) {
    const member = await botGuildMember(token, guildId, userId);
    if (member.user.id !== userId || member.user.bot) throw new Error('Виключений учасник має належати цьому серверу.');
  }
  await activity().saveSettings(guildId, value, access.user.id);
  revalidatePath(`/servers/${guildId}`, 'layout');
}

export async function enableActivity(guildId: string): Promise<void> {
  const access = await requireGuildAccess(guildId, 'activity.manage');
  const settings = await activity().getSettings(guildId);
  await activity().saveSettings(guildId, { ...settings, enabled: true }, access.user.id);
  revalidatePath(`/servers/${guildId}`, 'layout');
}

export async function setActivityGameIgnored(guildId: string, form: FormData): Promise<void> {
  const access = await requireGuildAccess(guildId, 'activity.manage');
  const gameKey = activityGameKeySchema.parse(form.get('gameKey'));
  const mode = form.get('mode');
  if (mode !== 'ignore' && mode !== 'track') throw new Error('Невідома дія.');
  await activity().setGameIgnored(guildId, gameKey, mode === 'ignore', access.user.id);
  revalidatePath(`/servers/${guildId}/activity`, 'layout');
}
