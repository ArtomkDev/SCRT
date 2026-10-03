import { GatewayIntentBits } from 'discord.js';
import { botPresenceIntentAvailable } from '@scrt/discord';
import { log } from '@scrt/shared';

export function activityGatewayIntents(presence: boolean, existingMemberIntent: boolean) {
  return [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, ...(presence ? [GatewayIntentBits.GuildPresences] : []), ...(existingMemberIntent ? [GatewayIntentBits.GuildMembers] : [])];
}
export async function presenceIntentAvailable(botToken: string): Promise<boolean> {
  try {
    return await botPresenceIntentAvailable(botToken);
  } catch (error) {
    log('warn', 'activity', 'presence.preflight.unavailable', {}, error);
    return false;
  }
}
