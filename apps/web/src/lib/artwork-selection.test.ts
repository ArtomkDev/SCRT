import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { signArtworkSelection, verifyArtworkSelection } from './artwork-selection';

const secret = 'selection-test-secret';
const guild = '12345678901234567'; const key = 'name:valheim';
const asset = { url: 'https://cdn2.steamgriddb.com/hero/a.png', source: 'steamgriddb' as const, kind: 'hero' as const, entityId: '42', attributionUrl: 'https://www.steamgriddb.com/game/42' };
describe('signed gallery selections', () => {
  it('preserves provenance and rejects altered bytes, another guild, game or field', () => {
    const token = signArtworkSelection(secret, guild, key, 'hero', asset);
    expect(verifyArtworkSelection(secret, token, guild, key, 'hero')).toEqual(asset);
    expect(() => verifyArtworkSelection(secret, 'A' + token.slice(1), guild, key, 'hero')).toThrow();
    expect(() => verifyArtworkSelection(secret, token, '22345678901234567', key, 'hero')).toThrow();
    expect(() => verifyArtworkSelection(secret, token, guild, 'name:dota 2', 'hero')).toThrow();
    expect(() => verifyArtworkSelection(secret, token, guild, key, 'icon')).toThrow();
  });
  it('expires choices and rejects oversized tokens', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const token = signArtworkSelection(secret, guild, key, 'hero', asset);
      vi.setSystemTime(Date.now() + 31 * 60_000);
      expect(() => verifyArtworkSelection(secret, token, guild, key, 'hero')).toThrow();
      expect(() => verifyArtworkSelection(secret, 'a'.repeat(50_001), guild, key, 'hero')).toThrow();
    } finally { vi.useRealTimers(); }
  });
});
