import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Routes } from 'discord.js';

const fixture = vi.hoisted(() => ({
  put: vi.fn<(route: string, options: { body: unknown }) => Promise<unknown>>(),
  loadEnvironment: vi.fn(),
}));
vi.mock('dotenv', () => ({ config: fixture.loadEnvironment }));
vi.mock('discord.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('discord.js')>();
  return { ...original, REST: class {
    setToken() { return this; }
    put = fixture.put;
  } };
});

const applicationId = '1554222871528738846';
const developmentApplicationId = '12345678901234567';
const developmentGuildId = '1510366872653008996';
let priorExitCode: typeof process.exitCode;
beforeEach(() => {
  priorExitCode = process.exitCode;
  vi.resetModules();
  vi.clearAllMocks();
  fixture.put.mockResolvedValue([]);
  for (const [name, value] of Object.entries({
    FIREBASE_PROJECT_ID: 'test-project', FIREBASE_CLIENT_EMAIL: 'test@example.com', FIREBASE_PRIVATE_KEY: 'test-key',
    DISCORD_BOT_TOKEN: 'test-token', DISCORD_CLIENT_ID: applicationId, DISCORD_GUILD_ID: developmentGuildId,
  })) vi.stubEnv(name, value);
  vi.stubEnv('NODE_ENV', undefined);
  vi.stubEnv('RAILWAY_ENVIRONMENT_ID', undefined);
  vi.stubEnv('RAILWAY_PROJECT_ID', undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.exitCode = priorExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Command deployment scope', () => {
  it('uses the configured development guild for a local run with default NODE_ENV', async () => {
    vi.stubEnv('DISCORD_CLIENT_ID', developmentApplicationId);
    await import('./register-commands');
    expect(fixture.put).toHaveBeenCalledWith(Routes.applicationGuildCommands(developmentApplicationId, developmentGuildId), expect.objectContaining({ body: expect.any(Array) }));
    expect(fixture.loadEnvironment).toHaveBeenCalledOnce();
  });
  it.each([undefined, 'development', 'production'])('ignores the development guild on Railway with NODE_ENV=%s', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'hosted-environment');
    await import('./register-commands');
    expect(fixture.put).toHaveBeenCalledWith(Routes.applicationCommands(applicationId), expect.any(Object));
    expect(fixture.loadEnvironment).not.toHaveBeenCalled();
  });
  it('recognizes the Railway project marker independently of the environment marker', async () => {
    vi.stubEnv('RAILWAY_PROJECT_ID', 'hosted-project');
    await import('./register-commands');
    expect(fixture.put).toHaveBeenCalledWith(Routes.applicationCommands(applicationId), expect.any(Object));
    expect(fixture.loadEnvironment).not.toHaveBeenCalled();
  });
  it('uses global commands in production outside Railway', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await import('./register-commands');
    expect(fixture.put).toHaveBeenCalledWith(Routes.applicationCommands(applicationId), expect.any(Object));
    expect(fixture.loadEnvironment).not.toHaveBeenCalled();
  });
  it('uses global commands locally when no development guild is configured', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', undefined);
    await import('./register-commands');
    expect(fixture.put).toHaveBeenCalledWith(Routes.applicationCommands(applicationId), expect.any(Object));
  });
  it('reports registration failures without printing the raw Discord request', async () => {
    const failure = Object.assign(new Error('Missing Access'), { requestBody: { token: 'do-not-log' } });
    fixture.put.mockRejectedValueOnce(failure);
    await import('./register-commands');
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledOnce();
    const output = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(output).toContain('commands.registration.failed');
    expect(output).toContain(developmentGuildId);
    expect(output).toContain('Missing Access');
    expect(output).not.toContain('do-not-log');
  });
});
