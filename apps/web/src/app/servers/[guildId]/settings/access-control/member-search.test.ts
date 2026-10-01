import { describe, expect, it } from 'vitest';
import { highlightedParts, memberAccessLevels, memberSearchIndex, searchMemberIndex, searchMembers } from './member-search-utils';

const members = [
  { id: '123456789012345678', username: 'first_user', globalName: 'Global Name', nick: 'Приватний Нік', avatarUrl: 'https://cdn.discordapp.com/a.png', roleIds: [] },
  { id: '223456789012345678', username: 'second_user', globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/b.png', roleIds: [] },
];

describe('local guild member search', () => {
  it('finds substrings in guild nick, global name, username, and ID', () => {
    for (const query of ['ватн', 'global', 'FIRST_', '1234567890']) {
      expect(searchMembers(members, query, new Set()).matches.map((member) => member.id)).toContain(members[0]!.id);
    }
  });

  it('supports terms across fields and puts existing grants last without excluding them', () => {
    expect(searchMembers(members, 'приватний first', new Set()).total).toBe(1);
    expect(searchMembers(members, 'user', new Set([members[0]!.id])).matches.map((member) => member.id)).toEqual([members[1]!.id, members[0]!.id]);
    expect(searchMembers(members, members[0]!.id, new Set([members[0]!.id])).total).toBe(1);
  });

  it('counts 100000 matching members while retaining only the best 30 results', () => {
    const large = Array.from({ length: 100_000 }, (_, i) => ({ ...members[1]!, id: String(300000000000000000n + BigInt(i)), username: `user_${String(i).padStart(6, '0')}` }));
    const index = memberSearchIndex(large);
    const result = searchMemberIndex(index, 'user', new Set());
    expect(result.total).toBe(100_000);
    expect(result.matches).toHaveLength(30);
    expect(result.matches[0]?.username).toBe('user_000000');
    expect(result.matches[29]?.username).toBe('user_000029');
    const exact = searchMemberIndex(index, 'user_099999', new Set());
    expect(exact.matches[0]?.id).toBe(large.at(-1)?.id);
  });
});

describe('search access labels and highlighting', () => {
  it('resolves owner, highest role/personal access, everyone and unassigned users', () => {
    const roster = [members[0]!, { ...members[1]!, roleIds: ['admin'] }, { ...members[1]!, id: 'third' }];
    const mappings = { roles: [{ discordRoleId: 'admin', appRole: 'SUPER_ADMIN' as const }], members: [{ discordUserId: members[1]!.id, appRole: 'VIEWER' as const }] };
    const levels = memberAccessLevels('guild', members[0]!.id, roster, mappings);
    expect(levels.get(members[0]!.id)).toBe('OWNER');
    expect(levels.get(members[1]!.id)).toBe('SUPER_ADMIN');
    expect(levels.has('third')).toBe(false);
    expect(memberAccessLevels('guild', members[0]!.id, roster, { ...mappings, roles: [...mappings.roles, { discordRoleId: 'guild', appRole: 'SUPER_ADMIN' }] }).get('third')).toBe('VIEWER');
  });
  it('prioritizes unassigned matches even over exact matches with access', () => {
    const roster = [{ ...members[0]!, username: 'user' }, { ...members[1]!, username: 'some_user_name' }];
    expect(searchMembers(roster, 'user', new Set([roster[0]!.id])).matches[0]?.id).toBe(roster[1]!.id);
  });
  it.each([
    ['Приватний Нік', 'ВАТН', ['ватн']],
    ['Anna anna', 'ANNA', ['Anna', 'anna']],
    ['ﬃ ＡＢ', 'ffi ab', ['ﬃ', 'ＡＢ']],
    ['Cafe\u0301', 'café', ['Cafe\u0301']],
    ['123456789', '345', ['345']],
    ['banana', 'ana nan', ['anana']],
  ])('highlights normalized matches without changing original text: %s', (text, query, matches) => {
    const parts = highlightedParts(text, query);
    expect(parts.map((part) => part.text).join('')).toBe(text);
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(matches);
  });
  it('handles empty searches and literal markup safely as text', () => {
    expect(highlightedParts('Anna', '  ')).toEqual([{ text: 'Anna', match: false }]);
    expect(highlightedParts('<script>', 'script')).toEqual([{ text: '<', match: false }, { text: 'script', match: true }, { text: '>', match: false }]);
  });
});
