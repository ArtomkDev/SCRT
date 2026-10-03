import { describe, expect, it } from 'vitest';
import { botEnvSchema, parseEnvironment, webEnvSchema } from './index';

describe('environment', () => {
  it('accepts missing or empty optional artwork credentials', () => {
    const base = { FIREBASE_PROJECT_ID: 'project', FIREBASE_CLIENT_EMAIL: 'service@example.com', FIREBASE_PRIVATE_KEY: 'key', DISCORD_BOT_TOKEN: 'token', DISCORD_CLIENT_ID: 'id' };
    expect(botEnvSchema.parse(base).STEAMGRIDDB_API_KEY).toBeUndefined();
    expect(botEnvSchema.parse({ ...base, STEAMGRIDDB_API_KEY: '', IGDB_TWITCH_CLIENT_ID: ' ', IGDB_TWITCH_CLIENT_SECRET: '' }).IGDB_TWITCH_CLIENT_ID).toBeUndefined();
  });
  it('reports missing required values', () => expect(() => parseEnvironment(botEnvSchema, {})).toThrow(/DISCORD_BOT_TOKEN/));
  it('rejects weak session secrets', () => expect(() => parseEnvironment(webEnvSchema, { SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/));
});
