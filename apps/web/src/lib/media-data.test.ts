import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaSettingsSchema } from '@scrt/validation';

const mocks = vi.hoisted(() => ({ env: vi.fn(), settings: vi.fn(), session: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('./server', () => ({ env: mocks.env, media: () => ({ getSettings: mocks.settings, getSession: mocks.session }) }));
import { initialMediaSnapshot, mediaConfigurationError, mediaInternal } from './media-data';
import { runtimeLogSnapshot } from '@scrt/shared';

beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllGlobals();
  mocks.settings.mockResolvedValue(mediaSettingsSchema.parse({})); mocks.session.mockResolvedValue(null);
});

describe('Media control-plane configuration', () => {
  it.each([
    [{ MEDIA_BOT_URL: 'http://127.0.0.1:3100' }, 'MEDIA_INTERNAL_SECRET'],
    [{ MEDIA_INTERNAL_SECRET: 'test-secret'.repeat(4) }, 'MEDIA_BOT_URL'],
    [{}, 'MEDIA_INTERNAL_SECRET та MEDIA_BOT_URL'],
  ])('names the missing configuration and never sends an unconfigured request', async (config, missing) => {
    mocks.env.mockReturnValue(config); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(mediaInternal({ operation: 'state', guildId: '12345678901234567', actorUserId: '22345678901234567' })).rejects.toThrow(missing);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the missing-secret reason in the saved-state fallback', async () => {
    mocks.env.mockReturnValue({ MEDIA_BOT_URL: 'http://127.0.0.1:3100' });
    const initial = await initialMediaSnapshot('12345678901234567', '22345678901234567');
    expect(initial.unavailable).toContain('MEDIA_INTERNAL_SECRET');
    expect(initial.unavailable).toContain('Показано останній збережений стан');
    expect(initial.snapshot.controls).toEqual({});
  });

  it('accepts a configured channel without exposing its secret', () => {
    mocks.env.mockReturnValue({ MEDIA_INTERNAL_SECRET: 'test-secret'.repeat(4), MEDIA_BOT_URL: 'http://127.0.0.1:3100' });
    expect(mediaConfigurationError()).toBeNull();
  });

  it('explains an unreachable bot without returning connection details', async () => {
    mocks.env.mockReturnValue({ MEDIA_INTERNAL_SECRET: 'test-secret'.repeat(4), MEDIA_BOT_URL: 'http://127.0.0.1:3100' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED with private details')));
    await expect(mediaInternal({ operation: 'state', guildId: '12345678901234567', actorUserId: '22345678901234567' })).rejects.toThrow('запустіть або перезапустіть бота');
  });
  it('distinguishes a worker timeout and logs a request identity without its credentials', async () => {
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    mocks.env.mockReturnValue({ MEDIA_INTERNAL_SECRET: 'never-log-this-secret'.repeat(2), MEDIA_BOT_URL: 'https://private-worker.example' });
    const fetch = vi.fn().mockRejectedValue(new DOMException('Request timed out', 'TimeoutError')); vi.stubGlobal('fetch', fetch);
    await expect(mediaInternal({ operation: 'search', guildId: '12345678901234567', actorUserId: '22345678901234567', query: 'https://youtu.be/TwumA6YhQp4', page: 0 })).rejects.toMatchObject({ status: 503, message: expect.stringContaining('відведений час') });
    const entries = runtimeLogSnapshot({ runId: before.runId, after }).entries;
    const requestId = fetch.mock.calls[0]![1].headers['X-SCRT-Request'];
    expect(entries.find((entry) => entry.action === 'worker.request.failed')?.context).toMatchObject({ requestId, operation: 'search', timedOut: true, timeoutMs: 25000 });
    const logs = JSON.stringify(entries); expect(logs).not.toContain('never-log-this-secret'); expect(logs).not.toContain('private-worker.example'); expect(logs).not.toContain('TwumA6YhQp4');
  });

  it('explains mismatched API secrets without including either secret in the message', async () => {
    const secret = 'test-secret'.repeat(4);
    mocks.env.mockReturnValue({ MEDIA_INTERNAL_SECRET: secret, MEDIA_BOT_URL: 'http://127.0.0.1:3100' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Unauthorized' }, { status: 401 })));
    try {
      await mediaInternal({ operation: 'state', guildId: '12345678901234567', actorUserId: '22345678901234567' });
      throw new Error('Expected an authorization error');
    } catch (error) {
      expect(error).toMatchObject({ status: 401 });
      expect((error as Error).message).toContain('MEDIA_INTERNAL_SECRET');
      expect((error as Error).message).not.toContain(secret);
    }
  });
  it('preserves a source access refusal without labeling it as a worker outage', async () => {
    mocks.env.mockReturnValue({ MEDIA_INTERNAL_SECRET: 'test-secret'.repeat(4), MEDIA_BOT_URL: 'http://127.0.0.1:3100' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'YouTube вимагає авторизації.' }, { status: 422 })));
    await expect(mediaInternal({ operation: 'state', guildId: '12345678901234567', actorUserId: '22345678901234567' })).rejects.toMatchObject({ status: 422, message: 'YouTube вимагає авторизації.' });
  });
});
