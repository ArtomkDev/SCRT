import type { MediaTrack } from '@scrt/shared';

export const catalogSearchPageSize = 20;
export function normalizeSearchQuery(query: string): string {
  return query.normalize('NFKC').replace(/[\p{Cc}\s]+/gu, ' ').trim();
}
const transliteration: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ь: '', ю: 'yu', я: 'ya', ы: 'y', э: 'e', ё: 'yo', ъ: '',
};
function words(value: string): string[] {
  return [...new Set(value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[а-яіїєґ]/g, (letter) => transliteration[letter] ?? letter).match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 32);
}
function distance(a: string, b: string): number {
  if (a.length > 32 || b.length > 32 || Math.abs(a.length - b.length) > 2) return 3;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? j ? 0 : i : j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1);
  }
  return rows[a.length]![b.length]!;
}
function tokenScore(query: string, candidate: string): number {
  if (query === candidate) return 1;
  if (query.length >= 4 && candidate.startsWith(query)) return 0.85;
  if (query.length < 4) return 0;
  const edits = distance(query, candidate);
  return edits === 1 ? 0.82 : edits === 2 && query.length >= 7 ? 0.7 : 0;
}
function coverage(query: string[], candidate: string[]): number[] {
  return query.map((word) => Math.max(0, ...candidate.map((value) => tokenScore(word, value))));
}
export function searchRelevance(query: string, track: MediaTrack): number {
  const tokens = words(query); if (!tokens.length) return 0;
  const scores = coverage(tokens, words(`${track.title} ${track.artist}`));
  const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return score + (words(track.title).join(' ') === tokens.join(' ') ? 0.15 : 0);
}
const latinKeys = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const cyrillicKeys = 'йцукенгшщзхїфівапролджєячсмитьбю';
function vowelRatio(value: string, alphabet: RegExp, vowels: RegExp): number {
  const letters = value.match(alphabet) ?? [];
  return letters.length ? (value.match(vowels)?.length ?? 0) / letters.length : 0;
}
export function preferredSearchQuery(query: string): string {
  const lower = query.toLowerCase();
  // Only switch an implausible layout. Normal Ukrainian and English artist names remain intact.
  const cyrillic = /[а-яіїєґ]/.test(lower) && !/[a-z]/.test(lower);
  const source = cyrillic ? cyrillicKeys : latinKeys; const target = cyrillic ? latinKeys : cyrillicKeys;
  const converted = [...lower].map((letter) => source.includes(letter) ? target[source.indexOf(letter)] : letter).join('');
  const originalRatio = cyrillic ? vowelRatio(lower, /[а-яіїєґ]/g, /[аеєиіїоуюяыэё]/g) : vowelRatio(lower, /[a-z]/g, /[aeiouy]/g);
  const convertedRatio = cyrillic ? vowelRatio(converted, /[a-z]/g, /[aeiouy]/g) : vowelRatio(converted, /[а-яіїєґ]/g, /[аеєиіїоуюяыэё]/g);
  return lower.replace(/[^\p{L}]/gu, '').length >= 4 && originalRatio < 0.2 && convertedRatio >= 0.25 ? converted : query;
}
export function fallbackSearchQuery(query: string, tracks: MediaTrack[], known: MediaTrack[]): string | null {
  const dictionary = new Map<string, { word: string; count: number }>();
  for (const track of known) {
    const seen = new Set<string>();
    for (const word of `${track.title} ${track.artist}`.match(/[\p{L}\p{N}]+/gu) ?? []) {
      const normalized = words(word)[0]; if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized); const entry = dictionary.get(normalized);
      if (entry) entry.count++; else if (dictionary.size < 2048) dictionary.set(normalized, { word, count: 1 });
    }
  }
  let corrected = false;
  const correction = query.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const normalized = words(word)[0]; if (!normalized || normalized.length < 4 || dictionary.has(normalized)) return word;
    let best = 3; let choices: Array<{ word: string; count: number }> = [];
    for (const [candidate, entry] of dictionary) {
      const edits = distance(normalized, candidate);
      if (edits < best) { best = edits; choices = [entry]; } else if (edits === best) choices.push(entry);
    }
    choices.sort((a, b) => b.count - a.count);
    if (!choices.length || best > (normalized.length >= 7 ? 2 : 1) || choices.length > 1 && choices[0]!.count < choices[1]!.count * 2) return word;
    corrected = true; return choices[0]!.word;
  });
  if (corrected) return correction;
  const raw = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (raw.length >= 2 && raw.length <= 8) {
    const best = [...tracks].sort((a, b) => searchRelevance(query, b) - searchRelevance(query, a))[0];
    const scores = coverage(raw.map((word) => words(word)[0] ?? ''), best ? words(`${best.title} ${best.artist}`) : []);
    const weakest = scores.indexOf(Math.min(...scores));
    const remaining = raw.filter((_, index) => index !== weakest).join(' ');
    return remaining.length >= 3 ? remaining : null;
  }
  // A common transposition in a single title, e.g. "Nubm" → "Numb".
  if (raw.length === 1 && raw[0]!.length >= 4 && raw[0]!.length <= 32) {
    const word = raw[0]!; const swapped = `${word.slice(0, -2)}${word.at(-1)}${word.at(-2)}`;
    if (swapped !== word) return swapped;
  }
  return null;
}
