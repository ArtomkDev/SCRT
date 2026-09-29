import type { VoiceCreator } from '@scrt/validation';

type Placement = Pick<VoiceCreator, 'roomPlacement' | 'roomOrder'>;

/** The Discord voice-channel position to assign to a newly created room. */
export function roomInsertionIndex(
  orderedIds: string[],
  newRoomId: string,
  creatorChannelId: string | null,
  existingRoomIds: ReadonlySet<string>,
  { roomPlacement, roomOrder }: Placement,
): number {
  const newIndex = orderedIds.indexOf(newRoomId);
  if (newIndex < 0) return -1;
  const anchor = creatorChannelId === null ? -1 : orderedIds.indexOf(creatorChannelId);
  const above = roomPlacement === 'above' || roomPlacement === 'top';
  const relevant = orderedIds.flatMap((id, index) => id !== newRoomId && existingRoomIds.has(id)
    && (anchor < 0 || roomPlacement === 'top' || roomPlacement === 'bottom' || (above ? index < anchor : index > anchor)) ? [index] : []);

  if (anchor >= 0 && roomPlacement === 'above') {
    return roomOrder === 'newest_first' ? (relevant[0] ?? anchor) : anchor;
  }
  if (anchor >= 0 && roomPlacement === 'below') {
    return roomOrder === 'newest_first' ? anchor + 1 : (relevant.at(-1) ?? anchor) + 1;
  }
  if (above) return roomOrder === 'newest_first' ? (relevant[0] ?? 0) : (relevant.at(-1) ?? -1) + 1;
  return roomOrder === 'newest_first' ? (relevant[0] ?? newIndex) : newIndex;
}
