import { config } from 'dotenv';
import { DiscordAPIError, REST, Routes } from 'discord.js';
import { botEnv } from '@scrt/config';
import { log } from '@scrt/shared';
import { commands } from './commands';

const railway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
if (!railway && process.env.NODE_ENV !== 'production') config({ path: '../../.env' });
const env = botEnv();
const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN);
const developmentGuild = !railway && env.NODE_ENV === 'development' ? env.DISCORD_GUILD_ID : undefined;
const route = developmentGuild
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, developmentGuild)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);
const context = { applicationId: env.DISCORD_CLIENT_ID, scope: developmentGuild ? 'guild' : 'global', guildId: developmentGuild ?? null };
if (railway && env.DISCORD_GUILD_ID) log('warn', 'bot', 'commands.development-guild.ignored', { guildId: env.DISCORD_GUILD_ID });
try {
  await rest.put(route, { body: commands.map((command) => command.data.toJSON()) });
  log('info', 'bot', 'commands.registered', context);
} catch (error) {
  log('error', 'bot', 'commands.registration.failed', { ...context, status: error instanceof DiscordAPIError ? error.status : null, discordCode: error instanceof DiscordAPIError ? error.code : null }, new Error(error instanceof Error ? error.message : 'Command registration failed'));
  process.exitCode = 1;
}
