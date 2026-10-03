const aliases: Record<string, string> = { 'vs code': 'visual studio code', vscode: 'visual studio code', cs2: 'counter strike 2', obs: 'obs studio' };
export function normalizeArtworkName(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[™®]/gu, '').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
export function canonicalArtworkName(name: string): string {
  const normalized = normalizeArtworkName(name);
  return aliases[normalized] ?? normalized;
}
export type ArtworkCandidate = { id: number; name: string; aliases?: string[] };
export function chooseArtworkCandidate(name: string, candidates: readonly ArtworkCandidate[]) {
  const normalized = normalizeArtworkName(name);
  const canonical = canonicalArtworkName(name);
  const ranked = candidates.map((candidate) => {
    const names = [candidate.name, ...(candidate.aliases ?? [])].map(normalizeArtworkName);
    const confidence = names.includes(normalized) ? 1 : names.includes(canonical) ? 0.98 : 0;
    return { candidate, confidence };
  }).filter((item) => item.confidence >= 0.98).sort((a, b) => b.confidence - a.confidence || a.candidate.id - b.candidate.id);
  if (!ranked[0] || ranked[1]?.confidence === ranked[0].confidence && ranked[1].candidate.id !== ranked[0].candidate.id) return null;
  return ranked[0];
}
