import 'server-only';
import { webEnv } from '@scrt/config';
import { firestore, GuildRepository } from '@scrt/database';

export const env = () => webEnv();
export const guilds = () => {
  const config = env();
  return new GuildRepository(firestore({ projectId: config.FIREBASE_PROJECT_ID, clientEmail: config.FIREBASE_CLIENT_EMAIL, privateKey: config.FIREBASE_PRIVATE_KEY }));
};
export const appUrl = () => new URL(env().NEXT_PUBLIC_APP_URL);
export const callbackUrl = () => new URL('/api/auth/callback', appUrl()).toString();
