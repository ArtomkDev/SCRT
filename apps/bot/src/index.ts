import { config } from 'dotenv';
import { Client, Events, PermissionsBitField, type Guild, type GuildMember, type PartialGuildMember } from 'discord.js';
import { botEnv } from '@scrt/config';
import { firestore, GuildRepository, VoiceRepository, ActivityRepository, ActivityArtworkRepository } from '@scrt/database';
import { createArtworkResolver } from '@scrt/artwork';
import { log } from '@scrt/shared';
import { commands } from './commands';
import { VoiceError, VoiceService } from './voice/voice-service';
import { handleVoiceComponent } from './voice/voice-command';
import { ActivityModule } from './modules/activity/activity.module';
import { activityGatewayIntents, presenceIntentAvailable } from './modules/activity/gateway';

config({ path: '../../.env' });
const env = botEnv();
const db = firestore({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY });
const repository = new GuildRepository(db);
async function runBot(presenceAvailable: boolean): Promise<void> {
  const intents = activityGatewayIntents(presenceAvailable, env.DISCORD_GUILD_MEMBERS_INTENT);
  const client = new Client({ intents });
  const voice = new VoiceService(client, new VoiceRepository(db), repository);
  const activity = new ActivityModule(client, new ActivityRepository(db), presenceAvailable, createArtworkResolver(new ActivityArtworkRepository(db), env));
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
  async function initializeGuild(guild: Guild) {
    if (stopping || !guild.available) return;
    const results = await Promise.allSettled([syncGuild(guild), voice.recover(guild), activity.recover(guild)]);
    results.forEach((result, index) => {
      if (result.status === 'rejected') log('error', ['bot', 'voice', 'activity'][index]!, index === 0 ? 'guild.sync.failed' : 'recovery.failed', { guildId: guild.id }, result.reason);
    });
  }
  client.once(Events.ClientReady, (ready) => {
    activity.setConnected(true);
    log('info', 'bot', 'ready', { userId: ready.user.id, guildCount: ready.guilds.cache.size, activityInitialized: true, presenceAvailable, revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? null });
    for (const guild of ready.guilds.cache.values()) {
      void initializeGuild(guild);
    }
  });
  client.on(Events.GuildCreate, (guild) => { void initializeGuild(guild); });
  client.on(Events.GuildAvailable, (guild) => { if (client.isReady()) void initializeGuild(guild); });
  client.on(Events.GuildUnavailable, (guild) => {
    voice.stopGuild(guild.id);
    void activity.suspendGuild(guild.id).catch((error: unknown) => log('error', 'activity', 'guild.suspend.failed', { guildId: guild.id }, error));
  });
  client.on(Events.GuildUpdate, (_previous, guild) => { void syncGuild(guild).catch((error: unknown) => log('error', 'bot', 'guild.update.failed', { guildId: guild.id }, error)); });
  client.on(Events.GuildDelete, (guild) => { const pending = resourceSignals.get(guild.id); if (pending) clearTimeout(pending); resourceSignals.delete(guild.id); voice.stopGuild(guild.id); void activity.stopGuild(guild.id).catch((error: unknown) => log('error', 'activity', 'guild.leave.failed', { guildId: guild.id }, error)); void repository.markDisconnected(guild.id).catch((error: unknown) => log('error', 'bot', 'guild.leave.failed', { guildId: guild.id }, error)); });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void activity.onVoiceState(oldState, newState).catch((error: unknown) => log('error', 'activity', 'voice.state.failed', { guildId: newState.guild.id, userId: newState.id }, error));
    void voice.onVoiceState(oldState, newState).catch(async (error: unknown) => {
    log('error', 'voice', 'state.failed', { guildId: newState.guild.id, userId: newState.id, oldChannelId: oldState.channelId, newChannelId: newState.channelId }, error);
    if (error instanceof VoiceError && newState.member && !newState.member.user.bot) await newState.member.send(error.message).catch(() => undefined);
  }); });
  client.on(Events.MessageCreate, (message) => { void activity.onMessage(message).catch((error: unknown) => log('error', 'activity', 'message.failed', { guildId: message.guildId, userId: message.author.id }, error)); });
  client.on(Events.PresenceUpdate, (_before, after) => { void activity.onPresence(after).catch((error: unknown) => log('error', 'activity', 'presence.failed', { guildId: after.guild?.id, userId: after.userId }, error)); });
  client.on(Events.ShardDisconnect, () => { void activity.disconnect().catch((error: unknown) => log('error', 'activity', 'disconnect.failed', {}, error)); });
  const recoverActivity = () => { activity.setConnected(true); for (const guild of client.guilds.cache.values()) void activity.recover(guild).catch((error: unknown) => log('error', 'activity', 'reconnect.failed', { guildId: guild.id }, error)); };
  client.on(Events.ShardResume, recoverActivity);
  client.on(Events.ShardReady, () => { if (client.isReady()) recoverActivity(); });
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
  async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const pending of resourceSignals.values()) clearTimeout(pending);
    resourceSignals.clear();
    voice.stop();
    const deadline = setTimeout(() => { log('error', 'activity', 'shutdown.deadline'); process.exit(code || 1); }, 12_000);
    try { await activity.shutdown(); } catch (error) { log('error', 'activity', 'shutdown.flush.failed', {}, error); code = 1; }
    await client.destroy();
    clearTimeout(deadline);
    log('info', 'bot', 'shutdown');
    process.exitCode = code;
  }
  try { await client.login(env.DISCORD_BOT_TOKEN); } catch (error) {
    // Portal settings can change after preflight. Preserve core trackers on a presence rejection.
    if (presenceAvailable && error instanceof Error && /disallowed intents/i.test(error.message)) {
      log('warn', 'activity', 'presence.gateway.rejected');
      await activity.shutdown().catch(() => undefined);
      voice.stop();
      await client.destroy();
      return runBot(false);
    } else { log('error', 'bot', 'startup.failed', {}, error); await shutdown(1); return; }
  }
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('uncaughtException', (error) => { log('error', 'bot', 'uncaught-exception', {}, error); void shutdown(1); });
}
process.on('unhandledRejection', (error) => log('error', 'bot', 'unhandled-rejection', {}, error));
await runBot(await presenceIntentAvailable(env.DISCORD_BOT_TOKEN));
