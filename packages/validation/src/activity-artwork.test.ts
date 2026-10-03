import { describe, expect, it } from 'vitest';
import { artworkUrlSchema, artworkMappingSchema } from './activity-artwork';
describe('artwork URL boundary', () => {
  it.each(['http://images.example.com/a.png', 'file:///etc/passwd', 'https://localhost/a', 'https://127.0.0.1/a', 'https://2130706433/a', 'https://10.0.0.1/a', 'https://169.254.169.254/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://host.local/a', 'https://host.internal/a', 'https://user:pass@example.com/a', 'https://example.com:8443/a', 'https://example.com/a.gif', 'data:image/svg+xml;base64,YQ=='])('rejects unsafe %s', (url) => expect(artworkUrlSchema.safeParse(url).success).toBe(false));
  it('accepts a public HTTPS image and bounds its length', () => {
    expect(artworkUrlSchema.parse('https://images.example.com/icon.png')).toBe('https://images.example.com/icon.png');
    expect(artworkUrlSchema.safeParse('https://images.example.com/' + 'a'.repeat(2048)).success).toBe(false);
  });
  it('accepts only bounded numeric provider IDs', () => {
    expect(artworkMappingSchema.safeParse({ provider: 'igdb', entityId: '42' }).success).toBe(true);
    expect(artworkMappingSchema.safeParse({ provider: 'igdb', entityId: '42; fields *;' }).success).toBe(false);
  });
});
