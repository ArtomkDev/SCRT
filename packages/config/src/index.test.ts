import { describe, expect, it } from 'vitest';
import { botEnvSchema, parseEnvironment, webEnvSchema } from './index';

describe('environment', () => {
  it('reports missing required values', () => expect(() => parseEnvironment(botEnvSchema, {})).toThrow(/DISCORD_BOT_TOKEN/));
  it('rejects weak session secrets', () => expect(() => parseEnvironment(webEnvSchema, { SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/));
});
