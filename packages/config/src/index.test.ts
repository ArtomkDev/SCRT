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
  const web = { FIREBASE_PROJECT_ID: 'project', FIREBASE_CLIENT_EMAIL: 'service@example.com', FIREBASE_PRIVATE_KEY: 'key', DISCORD_BOT_TOKEN: 'token', DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 'secret', SESSION_SECRET: 's'.repeat(32) };
  it.each(['not-a-url', 'javascript:alert(1)', 'ftp://example.com', 'https://user:password@example.com', 'https://example.com/dashboard', 'https://example.com?next=evil', 'https://example.com#fragment'])('rejects an app URL that is not an HTTP origin: %s', (url) => {
    expect(() => parseEnvironment(webEnvSchema, { ...web, NEXT_PUBLIC_APP_URL: url })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
  it.each(['http://localhost:3000', 'https://example.com', 'https://example.com/'])('accepts a valid app origin: %s', (url) => {
    expect(webEnvSchema.parse({ ...web, NEXT_PUBLIC_APP_URL: url }).NEXT_PUBLIC_APP_URL).toBe(url);
  });
});
