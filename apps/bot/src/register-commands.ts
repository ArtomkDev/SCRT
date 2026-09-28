import { config } from 'dotenv';
import { REST, Routes } from 'discord.js';
import { botEnv } from '@scrt/config';
import { commands } from './commands';

config({ path: '../../.env' });
const env = botEnv();
const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN);
const route = env.NODE_ENV !== 'production' && env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);
await rest.put(route, { body: commands.map((command) => command.data.toJSON()) });
console.info('Slash commands registered');
