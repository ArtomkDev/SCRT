import type { SVGProps } from 'react';
const paths = {
  play: 'M8 5v14l11-7Z', pause: 'M9 5v14M15 5v14', next: 'm5 5 10 7-10 7ZM19 5v14', stop: 'M6 6h12v12H6Z',
  shuffle: 'M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 6-6m3-4c1-1 2-2 3-2h3m-4-4 4 4-4 4',
  repeat: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
  volume: 'm11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  plus: 'M12 5v14M5 12h14', up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6', remove: 'm6 6 12 12M6 18 18 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3c2 0 3 1 3 3m12-2a3 3 0 1 1-3-3c2 0 3 1 3 3M9 9l12-2',
  headphones: 'M3 14v-3a9 9 0 0 1 18 0v3M3 12h4v9H3Zm14 0h4v9h-4Z',
  queue: 'M3 6h18M3 12h12M3 18h12m4-6 4 3-4 3Z',
  history: 'M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  external: 'M14 3h7v7m0-7L10 14M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6',
} as const;
export function MediaIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} fill={name === 'play' ? 'currentColor' : 'none'} /></svg>;
}
