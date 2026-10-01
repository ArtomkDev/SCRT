import { describe, expect, it } from 'vitest';
import { accessRoleMember, scopeDirectoryEvent } from './member-directory-scope';

const mapped = new Set(['123456789012345678']);
const guildId = '423456789012345678';
const member = { id: '223456789012345678', username: 'user', globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/a.png', roleIds: ['123456789012345678', '323456789012345678'] };

describe('scoped access-role directory', () => {
  it('includes only members of mapped roles and strips other role IDs', () => {
    expect(accessRoleMember(guildId, member, mapped)?.roleIds).toEqual(['123456789012345678']);
    expect(accessRoleMember(guildId, { ...member, roleIds: ['323456789012345678'] }, mapped)).toBeNull();
  });
  it('does not send unrelated member identities in live events', () => {
    const event = { kind: 'change' as const, revision: 2, change: { kind: 'upsert' as const, member: { ...member, roleIds: ['323456789012345678'] }, previousRoleIds: [] } };
    expect(scopeDirectoryEvent(guildId, event, mapped)).toEqual({ kind: 'advance', revision: 2 });
    expect(scopeDirectoryEvent(guildId, { ...event, change: { ...event.change, previousRoleIds: ['123456789012345678'] } }, mapped)).toEqual({ kind: 'change', revision: 2, change: { kind: 'remove', memberId: member.id } });
  });
  it('sends mapped members with only mapped role IDs and suppresses unrelated departures', () => {
    expect(scopeDirectoryEvent(guildId, { kind: 'change', revision: 3, change: { kind: 'upsert', member, previousRoleIds: [] } }, mapped)).toEqual({ kind: 'change', revision: 3, change: { kind: 'upsert', member: { ...member, roleIds: ['123456789012345678'] } } });
    expect(scopeDirectoryEvent(guildId, { kind: 'change', revision: 4, change: { kind: 'remove', memberId: member.id, roleIds: ['323456789012345678'] } }, mapped)).toEqual({ kind: 'advance', revision: 4 });
    expect(scopeDirectoryEvent(guildId, { kind: 'change', revision: 5, change: { kind: 'remove', memberId: member.id, roleIds: [mapped.values().next().value!] } }, mapped)).toEqual({ kind: 'change', revision: 5, change: { kind: 'remove', memberId: member.id } });
  });
  it('includes every member in the @everyone scope and sends departures', () => {
    const everyone = new Set([guildId]);
    expect(accessRoleMember(guildId, { ...member, roleIds: [] }, everyone)?.roleIds).toEqual([guildId]);
    expect(scopeDirectoryEvent(guildId, { kind: 'change', revision: 6, change: { kind: 'remove', memberId: member.id } }, everyone)).toEqual({ kind: 'change', revision: 6, change: { kind: 'remove', memberId: member.id } });
  });
});
