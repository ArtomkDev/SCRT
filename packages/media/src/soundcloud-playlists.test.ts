import { describe, expect, it, vi } from 'vitest';
import { SoundCloudPlaylists } from './soundcloud-playlists';
import type { readMediaDocument } from './audio-http';
import { mediaPlaylistReferenceSchema } from '@scrt/validation';

const reference = 'https://soundcloud.com/artist/sets/favorites';
const track = (id: number, extra = {}) => ({ id, title: `Song ${id}`, permalink_url: `https://soundcloud.com/artist/song-${id}`, duration: 60000, artwork_url: null, streamable: true, sharing: 'public', policy: 'ALLOW', state: 'finished', user: { username: 'Artist' }, ...extra });
function html(tracks: object[], extra = {}) {
  return `<script>window.__sc_hydration = ${JSON.stringify([{ hydratable: 'apiClient', data: { id: 'a'.repeat(32) } }, { hydratable: 'playlist', data: {
    kind: 'playlist', title: 'Collection', permalink_url: reference, user: { username: 'Artist' }, artwork_url: null, public: true, sharing: 'public', track_count: tracks.length, tracks, ...extra,
  } }])};</script>`;
}
describe('public SoundCloud playlists', () => {
  it('normalizes sharing links and rejects private, credentialed or unrelated URLs', () => {
    expect(mediaPlaylistReferenceSchema.parse('http://www.soundcloud.com/artist/sets/favorites/?si=share')).toBe(reference);
    for (const value of ['https://soundcloud.com/artist/song', `${reference}/s-secret`, `${reference}?secret_token=secret`, 'https://attacker.example/artist/sets/list', 'https://user:password@soundcloud.com/artist/sets/list', 'https://soundcloud.com:444/artist/sets/list']) expect(mediaPlaylistReferenceSchema.safeParse(value).success).toBe(false);
  });
  it('loads without audio extraction and caches only public metadata', async () => {
    const read = vi.fn<typeof readMediaDocument>().mockResolvedValue(html([track(1, { track_authorization: 'secret', media: { transcodings: [{ url: 'secret' }] } }), track(2, { policy: 'SNIP' })]));
    const provider = new SoundCloudPlaylists(read);
    const [first, second] = await Promise.all([provider.page(reference), provider.page(`${reference}?si=share`)]);
    expect(read).toHaveBeenCalledTimes(1); expect(first).toEqual(second);
    expect(first.entries.map((entry) => [entry.position, entry.track.title, entry.track.playable])).toEqual([[1, 'Song 1', true], [2, 'Song 2', false]]);
    expect(JSON.stringify(first)).not.toContain('secret'); expect(first.nextPage).toBeNull();
    first.entries.length = 0;
    expect((await provider.page(reference)).entries).toHaveLength(2);
    expect(read.mock.calls[0]?.[1]).toMatchObject({ hosts: ['soundcloud.com'], maxBytes: 8000000 });
  });
  it('does not mistake a description delimiter for the end of the public catalog', async () => {
    const read = vi.fn<typeof readMediaDocument>().mockResolvedValue(html([track(1)], { description: 'A description containing ]; and other punctuation.' }));
    expect((await new SoundCloudPlaylists(read).page(reference)).entries).toHaveLength(1);
  });
  it('hydrates missing track metadata in one bounded request and restores the original order', async () => {
    const read = vi.fn<typeof readMediaDocument>().mockResolvedValueOnce(html([{ id: 1 }, { id: 2 }, { id: 3 }])).mockResolvedValueOnce(JSON.stringify([track(2), track(1)]));
    const result = await new SoundCloudPlaylists(read).page(reference);
    expect(result.entries.map((entry) => [entry.position, entry.track.title])).toEqual([[1, 'Song 1'], [2, 'Song 2']]);
    expect(result.unavailableCount).toBe(1); expect(read).toHaveBeenCalledTimes(2);
    const request = new URL(read.mock.calls[1]![0]); expect(request.hostname).toBe('api-v2.soundcloud.com'); expect(request.searchParams.get('ids')).toBe('1,2,3');
  });
  it('paginates large sets without loading or playing every track and skips unsafe references', async () => {
    const tracks = Array.from({ length: 51 }, (_, index) => track(index + 1)); tracks[1] = track(2, { permalink_url: 'http://localhost/private' });
    const read = vi.fn<typeof readMediaDocument>().mockResolvedValue(html(tracks)); const provider = new SoundCloudPlaylists(read);
    const first = await provider.page(reference); const last = await provider.page(reference, 1);
    expect(first.entries).toHaveLength(49); expect(first.nextPage).toBe(1); expect(first.unavailableCount).toBe(1);
    expect(last.entries.map((entry) => entry.position)).toEqual([51]); expect(last.nextPage).toBeNull(); expect(read).toHaveBeenCalledTimes(1);
    await expect(provider.page(reference, 10)).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
  });
  it('rejects private, changed or incomplete lists and retries failures instead of caching them', async () => {
    for (const extra of [{ public: false }, { sharing: 'private' }, { permalink_url: 'https://soundcloud.com/artist/sets/other' }, { track_count: 2 }]) {
      const read = vi.fn<typeof readMediaDocument>().mockResolvedValueOnce(html([track(1)], extra)).mockResolvedValueOnce(html([track(1)]));
      const provider = new SoundCloudPlaylists(read); await expect(provider.page(reference)).rejects.toThrow();
      expect((await provider.page(reference)).entries).toHaveLength(1);
    }
  });
});
