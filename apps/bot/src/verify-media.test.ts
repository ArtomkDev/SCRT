import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ environment: vi.fn(), probe: vi.fn(), extractor: vi.fn(), engine: vi.fn() }));
vi.mock('dotenv', () => ({ config: mocks.environment }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.probe }));
vi.mock('@scrt/media', () => ({
  createMediaSources: () => ({ health: () => [] }), extractorExecutable: () => '/tools/yt-dlp',
  YtDlpExtractor: class { available = mocks.extractor; },
}));
vi.mock('./modules/media/media-command', () => ({ mediaCommandData: { name: 'media' } }));
vi.mock('./modules/media/playback-engine', () => ({ playbackDependencies: mocks.engine }));
let previousExit: typeof process.exitCode;
beforeEach(() => {
  previousExit = process.exitCode; process.exitCode = 0;
  vi.resetModules(); vi.resetAllMocks();
  mocks.extractor.mockReturnValue(true); mocks.probe.mockReturnValue({ status: 0 });
  mocks.engine.mockReturnValue({ available: true, ffmpeg: true, opus: true, dave: true });
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('RAILWAY_PROJECT_ID', undefined); vi.stubEnv('RAILWAY_ENVIRONMENT_ID', undefined);
  vi.stubEnv('MEDIA_INTERNAL_SECRET', 'm'.repeat(32)); vi.stubEnv('SESSION_SECRET', 's'.repeat(32)); vi.stubEnv('MEDIA_INTERNAL_HOST', '::'); vi.stubEnv('MEDIA_INTERNAL_PORT', '3100');
  vi.spyOn(console, 'info').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { process.exitCode = previousExit; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('deployable Media diagnostic', () => {
  it('checks executable startup without loading local production credentials or exposing secrets', async () => {
    await import('./verify-media');
    expect(process.exitCode).toBe(0); expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.probe).toHaveBeenCalledWith('/tools/yt-dlp', ['--version'], expect.objectContaining({ timeout: 5000 }));
    const output = String(vi.mocked(console.info).mock.calls[0]![0]);
    expect(JSON.parse(output)).toMatchObject({ ready: true, extractorAvailable: true, internalSecretConfigured: true });
    expect(output).not.toContain(process.env.MEDIA_INTERNAL_SECRET); expect(output).not.toContain(process.env.SESSION_SECRET);
  });
  it.each(['absent', 'non-executable', 'secret', 'shared-secret', 'port', 'engine'])('exits unsuccessfully for missing readiness prerequisite: %s', async (failure) => {
    if (failure === 'absent') mocks.extractor.mockReturnValue(false);
    if (failure === 'non-executable') mocks.probe.mockReturnValue({ status: null });
    if (failure === 'secret') vi.stubEnv('MEDIA_INTERNAL_SECRET', undefined);
    if (failure === 'shared-secret') vi.stubEnv('MEDIA_INTERNAL_SECRET', process.env.SESSION_SECRET);
    if (failure === 'port') vi.stubEnv('MEDIA_INTERNAL_PORT', '70000');
    if (failure === 'engine') mocks.engine.mockReturnValue({ available: false, ffmpeg: false, opus: true, dave: true });
    await import('./verify-media');
    expect(process.exitCode).toBe(1); expect(JSON.parse(String(vi.mocked(console.info).mock.calls[0]![0])).ready).toBe(false);
  });
});
