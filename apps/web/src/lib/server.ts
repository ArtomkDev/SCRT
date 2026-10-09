import 'server-only';
import { cache } from 'react';
import { webEnv } from '@scrt/config';
import { firestore, GuildRepository, VoiceRepository, ActivityRepository, ActivityLeaderboardService, ActivityArtworkRepository, MediaRepository } from '@scrt/database';
import { createArtworkResolver, type ActivityArtworkResolver } from '@scrt/artwork';

let configuration: ReturnType<typeof webEnv> | undefined;
let guildRepository: GuildRepository | undefined;
let voiceRepository: VoiceRepository | undefined;
let activityRepository: ActivityRepository | undefined;
let mediaRepository: MediaRepository | undefined;
let artworkRepository: ActivityArtworkRepository | undefined;
let artworkResolver: ActivityArtworkResolver | undefined;
export const env = () => configuration ??= webEnv();
const database = () => {
  const config = env();
  return firestore({ projectId: config.FIREBASE_PROJECT_ID, clientEmail: config.FIREBASE_CLIENT_EMAIL, privateKey: config.FIREBASE_PRIVATE_KEY });
};
export const guilds = () => guildRepository ??= new GuildRepository(database());
export const voice = () => voiceRepository ??= new VoiceRepository(database());
export const activity = () => activityRepository ??= new ActivityRepository(database());
export const media = () => mediaRepository ??= new MediaRepository(database());
export const activityArtworkStore = () => artworkRepository ??= new ActivityArtworkRepository(database());
export const activityArtworkResolver = () => artworkResolver ??= createArtworkResolver(activityArtworkStore(), env());
export const activityLeaderboards = cache(() => new ActivityLeaderboardService(activity()));
export const appUrl = () => new URL(env().NEXT_PUBLIC_APP_URL);
export const callbackUrl = () => new URL('/api/auth/callback', appUrl()).toString();
