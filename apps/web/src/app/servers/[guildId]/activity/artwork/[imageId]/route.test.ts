import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), upload: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/server', () => ({ activityArtworkStore: () => ({ upload: mocks.upload }) }));
import { GET } from './route';
const guildId = '12345678901234567'; const imageId = 'a'.repeat(64);
const context = { params: Promise.resolve({ guildId, imageId }) };
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({}); });
describe('guild uploaded image route', () => {
  it('requires live view permission before reading image bytes', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(GET(new Request('https://example.com'), context)).rejects.toThrow('Forbidden');
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.view');
  });
  it('serves static WebP privately and reports missing/cross-guild images as 404', async () => {
    const bytes = Buffer.from('RIFF1234WEBP'); mocks.upload.mockResolvedValue(bytes);
    const response = await GET(new Request('https://example.com'), context);
    expect(mocks.upload).toHaveBeenCalledWith(guildId, imageId);
    expect(response.headers.get('content-type')).toBe('image/webp'); expect(response.headers.get('cache-control')).toContain('private');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    mocks.upload.mockResolvedValue(null); expect((await GET(new Request('https://example.com'), context)).status).toBe(404);
  });
});
