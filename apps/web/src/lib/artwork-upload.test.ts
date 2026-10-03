import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
import { ARTWORK_UPLOAD_LIMIT, prepareArtworkUpload } from './artwork-upload';
describe('uploaded image decoding', () => {
  it('decodes real bytes despite a false MIME type, resizes and strips metadata', async () => {
    const source = await sharp({ create: { width: 1800, height: 1000, channels: 4, background: '#4a6aff' } }).png().withMetadata().toBuffer();
    const file = new File([new Uint8Array(source)], 'photo.bin', { type: 'application/octet-stream' });
    const result = await prepareArtworkUpload(file, 'hero');
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('webp'); expect(metadata.width).toBe(1600); expect(metadata.height).toBeLessThanOrEqual(900);
    expect(metadata.exif).toBeUndefined(); expect(result.length).toBeLessThanOrEqual(400_000);
    const icon = await prepareArtworkUpload(file, 'icon'); expect((await sharp(icon).metadata()).width).toBe(256);
  });
  it('rejects disguised SVG, corrupt image bytes and excessive input before persistence', async () => {
    await expect(prepareArtworkUpload(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'], 'icon.png', { type: 'image/png' }), 'icon')).rejects.toThrow();
    await expect(prepareArtworkUpload(new File(['broken'], 'icon.png', { type: 'image/png' }), 'icon')).rejects.toThrow();
    await expect(prepareArtworkUpload(new File([new Uint8Array(ARTWORK_UPLOAD_LIMIT + 1)], 'large.jpg'), 'hero')).rejects.toThrow('4 МБ');
  });
  it('rejects animated WebP and GIF', async () => {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    await expect(prepareArtworkUpload(new File([new Uint8Array(gif)], 'still.gif'), 'icon')).rejects.toThrow('PNG');
    const animated = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(prepareArtworkUpload(new File([new Uint8Array(animated)], 'animated.webp'), 'hero')).rejects.toThrow();
  });
});
