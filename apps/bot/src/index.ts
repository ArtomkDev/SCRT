import { config } from 'dotenv';
import { Client, Events, GatewayIntentBits, PermissionsBitField, type Guild, type GuildMember, type PartialGuildMember } from 'discord.js';
import { botEnv } from '@scrt/config';
import { firestore, GuildRepository, VoiceRepository } from '@scrt/database';
import { log } from '@scrt/shared';
import { commands } from './commands';
import { VoiceError, VoiceService } from './voice/voice-service';
import { handleVoiceComponent } from './voice/voice-command';

config({ path: '../../.env' });
const env = botEnv();
const db = firestore({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY });
const repository = new GuildRepository(db);
const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
if (env.DISCORD_GUILD_MEMBERS_INTENT) intents.push(GatewayIntentBits.GuildMembers);
const client = new Client({ intents });
const voice = new VoiceService(client, new VoiceRepository(db), repository);
const resourceSignals = new Map<string, NodeJS.Timeout>();
let stopping = false;

function signalResourcesChanged(guildId: string) {
  if (stopping) return;
  const pending = resourceSignals.get(guildId);
  if (pending) clearTimeout(pending);
  resourceSignals.set(guildId, setTimeout(() => {
    resourceSignals.delete(guildId);
    void repository.signalResourcesChanged(guildId).catch((error: unknown) => log('error', 'bot', 'guild.resources.signal.failed', { guildId }, error));
  }, 350));
}

async function syncGuild(guild: Guild) {
  const administratorRoleIds = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id && role.permissions.has(PermissionsBitField.Flags.Administrator))
    .map((role) => role.id);
  await repository.upsertInstalled({ guildId: guild.id, name: guild.name, icon: guild.icon, ownerId: guild.ownerId }, administratorRoleIds);
  log('info', 'bot', 'guild.synced', { guildId: guild.id });
}
client.once(Events.ClientReady, async (ready) => {
  log('info', 'bot', 'ready', { userId: ready.user.id, guildCount: ready.guilds.cache.size });
  for (const guild of ready.guilds.cache.values()) {
    try { await syncGuild(guild); } catch (error) { log('error', 'bot', 'guild.sync.failed', { guildId: guild.id }, error); }
    try { await voice.recover(guild); } catch (error) { log('error', 'voice', 'recovery.failed', { guildId: guild.id }, error); }
  }
});
client.on(Events.GuildCreate, (guild) => { void syncGuild(guild).then(() => voice.recover(guild)).catch((error: unknown) => log('error', 'bot', 'guild.join.failed', { guildId: guild.id }, error)); });
client.on(Events.GuildUpdate, (_previous, guild) => { void syncGuild(guild).catch((error: unknown) => log('error', 'bot', 'guild.update.failed', { guildId: guild.id }, error)); });
client.on(Events.GuildDelete, (guild) => { const pending = resourceSignals.get(guild.id); if (pending) clearTimeout(pending); resourceSignals.delete(guild.id); voice.stopGuild(guild.id); void repository.markDisconnected(guild.id).catch((error: unknown) => log('error', 'bot', 'guild.leave.failed', { guildId: guild.id }, error)); });
client.on(Events.VoiceStateUpdate, (oldState, newState) => { void voice.onVoiceState(oldState, newState).catch(async (error: unknown) => {
  log('error', 'voice', 'state.failed', { guildId: newState.guild.id, userId: newState.id, oldChannelId: oldState.channelId, newChannelId: newState.channelId }, error);
  if (error instanceof VoiceError && newState.member && !newState.member.user.bot) await newState.member.send(error.message).catch(() => undefined);
}); });
client.on(Events.ChannelCreate, (channel) => { if (!channel.isDMBased()) signalResourcesChanged(channel.guild.id); });
client.on(Events.ChannelUpdate, (_previous, channel) => { if (!channel.isDMBased()) signalResourcesChanged(channel.guild.id); });
client.on(Events.ChannelDelete, (channel) => { if (!channel.isDMBased()) { signalResourcesChanged(channel.guild.id); void voice.onChannelDelete(channel.guild, channel.id).catch((error: unknown) => log('error', 'voice', 'channel.delete.failed', { guildId: channel.guild.id, channelId: channel.id }, error)); } });
client.on(Events.GuildRoleCreate, (role) => signalResourcesChanged(role.guild.id));
client.on(Events.GuildRoleUpdate, (_previous, role) => signalResourcesChanged(role.guild.id));
client.on(Events.GuildRoleDelete, (role) => signalResourcesChanged(role.guild.id));
if (env.DISCORD_GUILD_MEMBERS_INTENT) {
  const profile = (member: GuildMember | PartialGuildMember) => ({ id: member.id, username: member.user.username, globalName: member.user.globalName, nick: member.nickname, avatarUrl: member.displayAvatarURL({ extension: 'webp', size: 64 }), roleIds: [...member.roles.cache.keys()] });
  const signal = (guildId: string, change: Parameters<typeof repository.signalMemberChange>[1]) => {
    if (stopping) return;
    void repository.signalMemberChange(guildId, change).catch((error: unknown) => log('error', 'bot', 'guild.member.signal.failed', { guildId }, error));
  };
  client.on(Events.GuildMemberAdd, (member) => { if (!member.user.bot) signal(member.guild.id, { kind: 'upsert', member: profile(member), previousRoleIds: [] }); });
  client.on(Events.GuildMemberRemove, (member) => { if (!member.user.bot) signal(member.guild.id, { kind: 'remove', memberId: member.id, roleIds: [...member.roles.cache.keys()] }); });
  client.on(Events.GuildMemberUpdate, (before, after) => {
    if (after.user.bot) return;
    const previous = profile(before);
    const current = profile(after);
    if (JSON.stringify(previous) !== JSON.stringify(current)) signal(after.guild.id, { kind: 'upsert', member: current, previousRoleIds: previous.roleIds });
  });
}
client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu()) {
    if (interaction.customId.startsWith('scrt:voice:v1:')) void handleVoiceComponent(interaction, voice).catch((error: unknown) => log('error', 'voice', 'component.failed', { guildId: interaction.guildId, userId: interaction.user.id }, error));
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = commands.find((item) => item.data.name === interaction.commandName);
  if (!command) return;
  void command.execute(interaction, voice).catch(async (error: unknown) => {
    log('error', 'bot', 'command.failed', { guildId: interaction.guildId, userId: interaction.user.id, command: interaction.commandName }, error);
    const content = error instanceof VoiceError ? error.message : 'Не вдалося виконати команду. Спробуйте пізніше.';
    try { if (interaction.deferred && !interaction.replied) await interaction.editReply({ content }); else if (interaction.replied || interaction.deferred) await interaction.followUp({ content, ephemeral: true }); else await interaction.reply({ content, ephemeral: true }); } catch (replyError) { log('error', 'bot', 'command.error-reply.failed', {}, replyError); }
  });
});
client.on(Events.Error, (error) => log('error', 'bot', 'gateway.error', {}, error));
process.on('unhandledRejection', (error) => log('error', 'bot', 'unhandled-rejection', {}, error));
process.on('uncaughtException', (error) => { log('error', 'bot', 'uncaught-exception', {}, error); void shutdown(1); });
async function shutdown(code = 0) { if (stopping) return; stopping = true; for (const pending of resourceSignals.values()) clearTimeout(pending); resourceSignals.clear(); voice.stop(); client.destroy(); log('info', 'bot', 'shutdown'); process.exitCode = code; }
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
try { await client.login(env.DISCORD_BOT_TOKEN); } catch (error) { log('error', 'bot', 'startup.failed', {}, error); await shutdown(1); }
