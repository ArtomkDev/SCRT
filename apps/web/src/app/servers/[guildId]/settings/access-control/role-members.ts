import type { BotGuildRole } from '@scrt/discord';
import type { RoleMapping } from '@scrt/permissions';
import type { DirectoryMember } from '@scrt/validation';

export function membersByHighestAccessRole(
  guildId: string, members: readonly DirectoryMember[], mappings: readonly RoleMapping[], roles: readonly BotGuildRole[], ownerId: string,
): Map<string, DirectoryMember[]> {
  const mappedIds = new Set(mappings.map((mapping) => mapping.discordRoleId));
  const hierarchy = roles.filter((role) => mappedIds.has(role.id)).sort((left, right) => right.position - left.position || right.id.localeCompare(left.id));
  const groups = new Map(hierarchy.map((role) => [role.id, [] as DirectoryMember[]]));
  const rank = new Map(hierarchy.map((role, index) => [role.id, index]));
  for (const member of members) {
    if (member.id === ownerId) continue;
    let highest = rank.get(guildId) ?? Infinity;
    for (const roleId of member.roleIds) highest = Math.min(highest, rank.get(roleId) ?? Infinity);
    const top = hierarchy[highest];
    if (top) groups.get(top.id)?.push(member);
  }
  return groups;
}
