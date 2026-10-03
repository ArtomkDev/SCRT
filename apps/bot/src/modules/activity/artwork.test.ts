import { describe, expect, it, vi } from 'vitest';
import type { Activity } from 'discord.js';
import { discordActivityArtwork } from './artwork';
describe('Discord artwork boundary', () => {
  it('uses installed asset URL methods with static formats and useful source sizes', () => {
    const small = vi.fn(() => 'https://cdn.discordapp.com/app-assets/123/456.png');
    const large = vi.fn(() => 'https://media.discordapp.net/external/hash/image.png');
    const result = discordActivityArtwork({ assets: { smallImageURL: small, largeImageURL: large } } as unknown as Activity);
    expect(small).toHaveBeenCalledWith({ extension: 'png', size: 64 }); expect(large).toHaveBeenCalledWith({ extension: 'png', size: 1024 });
    expect(result.heroUrl).toContain('format=png');
  });
  it('falls through with missing, invalid or unsupported application assets', () => {
    expect(discordActivityArtwork({ assets: null } as unknown as Activity)).toEqual({ iconUrl: null, heroUrl: null });
    expect(discordActivityArtwork({ assets: { smallImageURL: () => 'https://127.0.0.1/a', largeImageURL: () => { throw new Error('invalid'); } } } as unknown as Activity)).toEqual({ iconUrl: null, heroUrl: null });
  });
});
