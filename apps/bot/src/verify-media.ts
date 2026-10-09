import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { botEnvSchema } from '@scrt/config';
import { createMediaSources, extractorExecutable, YtDlpExtractor } from '@scrt/media';
import { mediaCommandData } from './modules/media/media-command';
if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT_ID && !process.env.RAILWAY_PROJECT_ID) config({ path: '../../.env', quiet: true });
try {
  const { playbackDependencies } = await import('./modules/media/playback-engine');
  const engine = playbackDependencies(process.env.MEDIA_FFMPEG_PATH);
  const control = botEnvSchema.pick({ MEDIA_INTERNAL_SECRET: true, MEDIA_INTERNAL_HOST: true, MEDIA_INTERNAL_PORT: true }).safeParse(process.env);
  const internalSecretConfigured = control.success && Boolean(control.data.MEDIA_INTERNAL_SECRET) && process.env.MEDIA_INTERNAL_SECRET !== process.env.SESSION_SECRET;
  const extractor = new YtDlpExtractor();
  const extractorAvailable = extractor.available() && spawnSync(extractorExecutable(), ['--version'], { timeout: 5000, windowsHide: true, stdio: 'ignore' }).status === 0;
  const ready = engine.available && extractorAvailable && internalSecretConfigured;
  console.info(JSON.stringify({ ready, engine, extractorAvailable, slashCommand: mediaCommandData.name, providers: createMediaSources(process.env, extractor).health(), internalSecretConfigured, controlConfigurationValid: control.success, liveDiscord: 'BLOCKED: no Gateway login or human Voice interaction in this diagnostic' }));
  if (!ready) process.exitCode = 1;
} catch { console.error('Media engine dependency import failed. Core bot modules are unaffected.'); process.exitCode = 1; }
