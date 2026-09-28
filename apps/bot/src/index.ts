import { config } from 'dotenv';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { botEnv } from '@scrt/config';
import { firestore, GuildRepository } from '@scrt/database';
import { log } from '@scrt/shared';
import { commands } from './commands';

config({ path: '../../.env' });
const env = botEnv();
const repository = new GuildRepository(firestore({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY }));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function syncGuild(guild: { id: string; name: string; icon: string | null; ownerId: string }) {
  await repository.upsertInstalled({ guildId: guild.id, name: guild.name, icon: guild.icon, ownerId: guild.ownerId });
  log('info', 'bot', 'guild.synced', { guildId: guild.id });
}
client.once(Events.ClientReady, async (ready) => {
  log('info', 'bot', 'ready', { userId: ready.user.id, guildCount: ready.guilds.cache.size });
  for (const guild of ready.guilds.cache.values()) {
    try { await syncGuild(guild); } catch (error) { log('error', 'bot', 'guild.sync.failed', { guildId: guild.id }, error); }
  }
});
client.on(Events.GuildCreate, (guild) => { void syncGuild(guild).catch((error: unknown) => log('error', 'bot', 'guild.join.failed', { guildId: guild.id }, error)); });
client.on(Events.GuildDelete, (guild) => { void repository.markDisconnected(guild.id).catch((error: unknown) => log('error', 'bot', 'guild.leave.failed', { guildId: guild.id }, error)); });
client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.find((item) => item.data.name === interaction.commandName);
  if (!command) return;
  void command.execute(interaction).catch(async (error: unknown) => {
    log('error', 'bot', 'command.failed', { guildId: interaction.guildId, userId: interaction.user.id, command: interaction.commandName }, error);
    try { if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Command failed. Please try again.', ephemeral: true }); else await interaction.reply({ content: 'Command failed. Please try again.', ephemeral: true }); } catch (replyError) { log('error', 'bot', 'command.error-reply.failed', {}, replyError); }
  });
});
client.on(Events.Error, (error) => log('error', 'bot', 'gateway.error', {}, error));
process.on('unhandledRejection', (error) => log('error', 'bot', 'unhandled-rejection', {}, error));
process.on('uncaughtException', (error) => { log('error', 'bot', 'uncaught-exception', {}, error); void shutdown(1); });
let stopping = false;
async function shutdown(code = 0) { if (stopping) return; stopping = true; client.destroy(); log('info', 'bot', 'shutdown'); process.exitCode = code; }
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
try { await client.login(env.DISCORD_BOT_TOKEN); } catch (error) { log('error', 'bot', 'startup.failed', {}, error); await shutdown(1); }
