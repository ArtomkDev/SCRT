import { describe, expect, it } from 'vitest';
import type { MediaTrack } from '@scrt/shared';
import { fallbackSearchQuery, normalizeSearchQuery, preferredSearchQuery, searchRelevance } from './search-query';

const song = (title: string, artist = 'Linkin Park'): MediaTrack => ({ provider: 'soundcloud', providerItemId: 'https://soundcloud.com/artist/song', title, artist, type: 'track', durationMs: 180000, artworkUrl: null, externalUrl: 'https://soundcloud.com/artist/song', playable: true, seekable: true, explicit: null });
describe('catalog query matching', () => {
  it('normalizes fullwidth characters, pasted whitespace and control characters', () => {
    expect(normalizeSearchQuery('  Ｎｕｍｂ\t\n Linkin\u0000 Park  ')).toBe('Numb Linkin Park');
  });
  it.each([
    ['дштлшт зфкл тгьи', 'linkin park numb'], ['ghbdsn', 'привіт'],
    ['Океан Ельзи', 'Океан Ельзи'], ['Щедрик', 'Щедрик'], ['Linkin Park', 'Linkin Park'], ['Skrillex', 'Skrillex'],
  ])('handles keyboard layout without rewriting valid titles: %s', (query, expected) => expect(preferredSearchQuery(query)).toBe(expected));
  it('ranks misspellings and adjacent transpositions above other songs by the same artist', () => {
    expect(searchRelevance('Linkn Park Nubm', song('Numb'))).toBeGreaterThan(searchRelevance('Linkn Park Nubm', song('In the End')));
    expect(searchRelevance('Metalica Nothing Else Matters', song('Nothing Else Matters', 'Metallica'))).toBeGreaterThan(0.9);
    expect(searchRelevance('Океан Ельзи Обійми', song('Обійми', 'Okean Elzy'))).toBeGreaterThan(0.9);
  });
  it('uses unambiguous catalog vocabulary for insertions, deletions and transpositions', () => {
    expect(fallbackSearchQuery('Linkn Park Nubm', [], [song('Numb')])).toBe('Linkin Park Numb');
    expect(fallbackSearchQuery('Metalllica Unforgven', [], [song('Unforgiven', 'Metallica')])).toBe('Metallica Unforgiven');
  });
  it('broadens a poorly matching artist/title query by dropping its weakest term', () => {
    expect(fallbackSearchQuery('Linkin Park Numm', [song('In the End')], [])).toBe('Linkin Park');
    expect(fallbackSearchQuery('Nubm', [], [])).toBe('Numb');
    expect(fallbackSearchQuery('ab', [], [])).toBeNull();
  });
  it('does not guess between equally close words', () => {
    expect(fallbackSearchQuery('Tast Artist', [], [song('Test', 'Artist'), song('Task', 'Artist')])).toBe('Artist');
  });
  it('uses repeated artist evidence to disambiguate a correction', () => {
    expect(fallbackSearchQuery('Linkn Park Nubm', [], [song('Numb'), song('In the End'), song('Faint'), song('Another track', 'Linking Words')])).toBe('Linkin Park Numb');
  });
});
