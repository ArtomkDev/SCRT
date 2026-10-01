import 'server-only';
import { webEnv } from '@scrt/config';
import { firestore, GuildRepository, VoiceRepository } from '@scrt/database';

let configuration: ReturnType<typeof webEnv> | undefined;
let guildRepository: GuildRepository | undefined;
let voiceRepository: VoiceRepository | undefined;
export const env = () => configuration ??= webEnv();
const database = () => {
  const config = env();
  return firestore({ projectId: config.FIREBASE_PROJECT_ID, clientEmail: config.FIREBASE_CLIENT_EMAIL, privateKey: config.FIREBASE_PRIVATE_KEY });
};
export const guilds = () => guildRepository ??= new GuildRepository(database());
export const voice = () => voiceRepository ??= new VoiceRepository(database());
export const appUrl = () => new URL(env().NEXT_PUBLIC_APP_URL);
export const callbackUrl = () => new URL('/api/auth/callback', appUrl()).toString();
