import { describe, expect, it } from 'vitest';
import { roomInsertionIndex } from './room-order';

describe('temporary room placement', () => {
  const ids = ['other', 'old', 'creator', 'newer', 'new'];
  const existing = new Set(['old', 'newer']);
  it('keeps older rooms above new ones when inserting above a Creator', () => {
    expect(roomInsertionIndex(ids, 'new', 'creator', existing, { roomPlacement: 'above', roomOrder: 'oldest_first' })).toBe(2);
    expect(roomInsertionIndex(ids, 'new', 'creator', existing, { roomPlacement: 'above', roomOrder: 'newest_first' })).toBe(1);
  });
  it('keeps the selected order below a Creator', () => {
    expect(roomInsertionIndex(ids, 'new', 'creator', existing, { roomPlacement: 'below', roomOrder: 'oldest_first' })).toBe(4);
    expect(roomInsertionIndex(ids, 'new', 'creator', existing, { roomPlacement: 'below', roomOrder: 'newest_first' })).toBe(3);
  });
  it('uses category edges when the Creator is elsewhere', () => {
    expect(roomInsertionIndex(ids, 'new', null, existing, { roomPlacement: 'above', roomOrder: 'newest_first' })).toBe(1);
    expect(roomInsertionIndex(ids, 'new', null, existing, { roomPlacement: 'below', roomOrder: 'oldest_first' })).toBe(4);
    expect(roomInsertionIndex(['other', 'new'], 'new', null, new Set(), { roomPlacement: 'top', roomOrder: 'oldest_first' })).toBe(0);
  });
});
