import { randomUUID, createPrivateKey } from 'node:crypto';
import { config } from 'dotenv';
import { REST, Routes } from 'discord.js';
import { z } from 'zod';
import { botEnv, webEnv } from '@scrt/config';
import { firestore } from '@scrt/database';

config({ path: '../../.env' });

const names = [
  'NODE_ENV', 'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID', 'NEXT_PUBLIC_APP_URL', 'SESSION_SECRET',
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
] as const;
for (const name of names) console.info(`${name}: ${process.env[name]?.trim() ? 'present' : 'missing'}`);

let phase = 'environment validation';
try {
const bot = botEnv();
const web = webEnv();
console.info('Bot and web environment schemas: valid');

phase = 'Firebase private key validation';
try {
  createPrivateKey(bot.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'));
  console.info('Firebase private key format: valid');
} catch {
  throw new Error('Firebase private key format: invalid');
}

phase = 'Discord bot authentication';
const rest = new REST({ version: '10' }).setToken(bot.DISCORD_BOT_TOKEN);
let selfResponse: unknown;
try {
  selfResponse = await rest.get(Routes.user('@me'));
} catch (error) {
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null;
  throw new Error(status === 401 ? 'DISCORD_BOT_TOKEN was rejected by Discord' : `Discord bot identity request failed${status ? ` (HTTP ${status})` : ''}`, { cause: error });
}
const self = z.object({ id: z.string(), bot: z.boolean() }).parse(selfResponse);
if (!self.bot) throw new Error('Discord token does not identify a bot');
if (self.id !== bot.DISCORD_CLIENT_ID) throw new Error('DISCORD_CLIENT_ID does not match the bot application');
console.info('Discord bot token and application ID: valid');

phase = 'Discord OAuth client credentials';
const oauthAuthorization = `Basic ${Buffer.from(`${web.DISCORD_CLIENT_ID}:${web.DISCORD_CLIENT_SECRET}`).toString('base64')}`;
const oauthResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
  method: 'POST',
  headers: { authorization: oauthAuthorization, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'identify' }),
});
if (!oauthResponse.ok) throw new Error(`DISCORD_CLIENT_SECRET or DISCORD_CLIENT_ID was rejected by Discord OAuth (HTTP ${oauthResponse.status})`);
const verificationToken = z.object({ access_token: z.string() }).parse(await oauthResponse.json()).access_token;
const revoke = await fetch('https://discord.com/api/v10/oauth2/token/revoke', {
  method: 'POST',
  headers: { authorization: oauthAuthorization, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token: verificationToken, token_type_hint: 'access_token' }),
});
if (!revoke.ok) throw new Error('Could not revoke the temporary OAuth verification token');
console.info('Discord OAuth client credentials: valid');

phase = 'development command lookup';
if (bot.DISCORD_GUILD_ID) {
  const registered = z.array(z.object({ name: z.string() })).parse(await rest.get(Routes.applicationGuildCommands(bot.DISCORD_CLIENT_ID, bot.DISCORD_GUILD_ID)));
  console.info(`/ping registered in development guild: ${registered.some((command) => command.name === 'ping') ? 'yes' : 'no'}`);
}

phase = 'Firestore write/read/delete';
const db = firestore({ projectId: bot.FIREBASE_PROJECT_ID, clientEmail: bot.FIREBASE_CLIENT_EMAIL, privateKey: bot.FIREBASE_PRIVATE_KEY });
const ref = db.collection('_internalVerification').doc(randomUUID());
let created = false;
try {
  await ref.create({ purpose: 'SCRT live integration verification', createdAt: new Date() });
  created = true;
  console.info('Firestore isolated write: pass');
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.get('purpose') !== 'SCRT live integration verification') throw new Error('Firestore verification read did not match');
  console.info('Firestore isolated read: pass');
} finally {
  if (created) {
    await ref.delete();
    console.info('Firestore isolated delete: pass');
  }
}

phase = 'development guild metadata lookup';
if (bot.DISCORD_GUILD_ID) {
  const guild = await db.collection('guilds').doc(bot.DISCORD_GUILD_ID).get();
  console.info(`Development guild Firestore record: ${guild.exists ? 'present' : 'absent'}`);
  if (guild.exists) {
    const required = ['guildId', 'name', 'icon', 'ownerId', 'botInstalled', 'installedAt', 'updatedAt', 'schemaVersion'];
    console.info(`Development guild metadata fields: ${required.every((field) => guild.get(field) !== undefined) ? 'complete' : 'incomplete'}`);
    console.info(`Development guild bot installation flag: ${guild.get('botInstalled') === true ? 'installed' : 'disconnected'}`);
  }
}

if (new URL(web.NEXT_PUBLIC_APP_URL).origin !== 'http://localhost:3000') console.info('Local OAuth origin: not localhost:3000');
else console.info('Local OAuth origin: valid');
} catch (error) {
  const safeMessage = error instanceof Error && (
    error.message === 'DISCORD_BOT_TOKEN was rejected by Discord' ||
    error.message === 'DISCORD_CLIENT_ID does not match the bot application' ||
    error.message.startsWith('DISCORD_CLIENT_SECRET or DISCORD_CLIENT_ID was rejected by Discord OAuth')
  ) ? error.message : `Live integration verification failed at ${phase}`;
  console.error(safeMessage);
  process.exitCode = 1;
}
