import type { DirectoryMember } from '@scrt/validation';
import type { AccessMappings, AppRole } from '@scrt/permissions';

const limit = 30;
const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

type SearchEntry = { member: DirectoryMember; fields: string[]; name: string };
type Match = { entry: SearchEntry; rank: number; hasAccess: boolean };

export const memberAccessLabels = { OWNER: 'Власник сервера', SUPER_ADMIN: 'Повний доступ', ADMIN: 'Налаштування бота', VIEWER: 'Лише перегляд' } as const;
const levelRank: Record<AppRole, number> = { VIEWER: 1, ADMIN: 2, SUPER_ADMIN: 3 };

// Presentation only; mutations still check live permissions on the server.
export function memberAccessLevels(guildId: string, ownerId: string, members: readonly DirectoryMember[], mappings: AccessMappings) {
  const roles = new Map(mappings.roles.map((mapping) => [mapping.discordRoleId, mapping.discordRoleId === guildId ? 'VIEWER' as const : mapping.appRole]));
  const personal = new Map(mappings.members.map((mapping) => [mapping.discordUserId, mapping.appRole]));
  const levels = new Map<string, keyof typeof memberAccessLabels>();
  for (const member of members) {
    if (member.id === ownerId) { levels.set(member.id, 'OWNER'); continue; }
    let level = personal.get(member.id) ?? roles.get(guildId);
    for (const roleId of member.roleIds) {
      const next = roles.get(roleId);
      if (next && (!level || levelRank[next] > levelRank[level])) level = next;
    }
    if (level) levels.set(member.id, level);
  }
  return levels;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function highlightedParts(text: string, query: string): { text: string; match: boolean }[] {
  const normalized = fold(text);
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean);
  const offsets: { start: number; end: number }[] = [];
  for (const { segment, index } of graphemes.segment(text)) {
    for (let i = 0; i < fold(segment).length; i++) offsets.push({ start: index, end: index + segment.length });
  }
  const ranges: { start: number; end: number }[] = [];
  for (const term of terms) {
    let index = normalized.indexOf(term);
    while (index !== -1) {
      const start = offsets[index]?.start;
      const end = offsets[index + term.length - 1]?.end;
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
      index = normalized.indexOf(term, index + 1);
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const prior = merged.at(-1);
    if (prior && range.start <= prior.end) prior.end = Math.max(prior.end, range.end);
    else merged.push({ ...range });
  }
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const { start, end } of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

export function memberSearchIndex(members: readonly DirectoryMember[]): SearchEntry[] {
  return members.map((member) => ({
    member,
    fields: [member.nick, member.globalName, member.username, member.id].filter((value): value is string => !!value).map(fold),
    name: member.nick ?? member.globalName ?? member.username,
  }));
}

export function searchMemberIndex(index: readonly SearchEntry[], query: string, deprioritized: Pick<ReadonlySet<string>, 'has'>) {
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return { matches: [] as DirectoryMember[], total: 0 };
  const exact = terms.join(' ');
  const matches: Match[] = [];
  let total = 0;
  const compare = (a: Match, b: Match) => Number(a.hasAccess) - Number(b.hasAccess) || a.rank - b.rank || a.entry.name.localeCompare(b.entry.name);
  for (const entry of index) {
    const fields = entry.fields;
    if (!terms.every((term) => fields.some((field) => field.includes(term)))) continue;
    total++;
    const rank = fields.some((field) => field === exact) ? 0 : fields.some((field) => field.startsWith(terms[0]!)) ? 1 : 2;
    const match = { entry, rank, hasAccess: deprioritized.has(entry.member.id) };
    if (matches.length === limit && compare(match, matches[limit - 1]!) >= 0) continue;
    let low = 0;
    let high = matches.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(match, matches[middle]!) < 0) high = middle;
      else low = middle + 1;
    }
    matches.splice(low, 0, match);
    if (matches.length > limit) matches.pop();
  }
  return { matches: matches.map(({ entry }) => entry.member), total };
}

export function searchMembers(members: readonly DirectoryMember[], query: string, deprioritized: Pick<ReadonlySet<string>, 'has'>) {
  return searchMemberIndex(memberSearchIndex(members), query, deprioritized);
}
