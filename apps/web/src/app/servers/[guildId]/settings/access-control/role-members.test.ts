import { describe, expect, it } from 'vitest';
import { membersByHighestAccessRole } from './role-members';

const role = (id: string, position: number) => ({ id, position, name: id, permissions: '0' });
const high = '123456789012345678';
const low = '223456789012345678';
const ownerId = '323456789012345678';
const member = (id: string, roleIds: string[]) => ({ id, roleIds, username: id, nick: null, globalName: null, avatarUrl: 'https://cdn.discordapp.com/a.png' });

describe('access role member placement', () => {
  it('places each human under only their highest mapped Discord role', () => {
    const grouped = membersByHighestAccessRole('623456789012345678',
      [member('423456789012345678', [high, low]), member('523456789012345678', [low]), member(ownerId, [high])],
      [{ discordRoleId: low, appRole: 'VIEWER' }, { discordRoleId: high, appRole: 'ADMIN' }],
      [role(low, 2), role(high, 10)], ownerId,
    );
    expect(grouped.get(high)?.map((entry) => entry.id)).toEqual(['423456789012345678']);
    expect(grouped.get(low)?.map((entry) => entry.id)).toEqual(['523456789012345678']);
  });
  it('places members without a mapped role under @everyone', () => {
    const guildId = '623456789012345678';
    const grouped = membersByHighestAccessRole(guildId,
      [member('423456789012345678', [high]), member('523456789012345678', [])],
      [{ discordRoleId: guildId, appRole: 'VIEWER' }, { discordRoleId: high, appRole: 'ADMIN' }],
      [role(guildId, 0), role(high, 10)], ownerId);
    expect(grouped.get(high)?.map((entry) => entry.id)).toEqual(['423456789012345678']);
    expect(grouped.get(guildId)?.map((entry) => entry.id)).toEqual(['523456789012345678']);
  });
});
