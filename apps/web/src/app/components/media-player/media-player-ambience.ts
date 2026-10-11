'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import { artworkPaletteStyle, type ArtworkPalette } from '@/app/servers/[guildId]/media/player-artwork';

// Coordinates are relative to the panel width and viewport height. Broad,
// overlapping fields keep the composition quiet around text and controls.
type Field = readonly [x: number, y: number, width: number, height: number];
type Composition = readonly [primary: Field, secondary: Field, tertiary: Field];
const compositions: readonly Composition[] = [
  [[.22, .2, 1.05, .4], [.92, .64, .9, .42], [.08, .92, 1.1, .38]],
  [[.82, .34, .95, .46], [.05, .8, 1.1, .38], [.94, .12, .85, .36]],
  [[.12, .66, 1.1, .42], [.88, .18, 1, .4], [.72, .95, .95, .38]],
  [[.92, .12, 1, .38], [.18, .5, .9, .46], [.06, .94, 1.15, .42]],
];

export function useMediaAmbience(trackKey: string | null, palette: ArtworkPalette): CSSProperties {
  const [selection, setSelection] = useState({ trackKey, index: 0 });
  // Update before committing so the header, panel and corner share a target.
  // Polls, pause/seek and gaps while loading do not change the composition.
  if (trackKey !== null && trackKey !== selection.trackKey) {
    setSelection({ trackKey, index: selection.trackKey === null ? 0 : (selection.index + 1) % compositions.length });
  }
  return useMemo(() => {
    const fields = compositions[selection.index]!;
    const geometry: Record<string, number> = {};
    for (const [index, name] of ['a', 'b', 'c'].entries()) {
      const [x, y, width, height] = fields[index]!;
      geometry[`--media-field-${name}-x`] = x;
      geometry[`--media-field-${name}-y`] = y;
      geometry[`--media-field-${name}-width`] = width;
      geometry[`--media-field-${name}-height`] = height;
    }
    return { ...artworkPaletteStyle(palette), ...geometry } as CSSProperties;
  }, [selection.index, palette]);
}
