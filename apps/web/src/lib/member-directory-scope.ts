import type { DirectoryEvent, DirectoryMember } from '@scrt/validation';

export function accessRoleMember(guildId: string, member: DirectoryMember, mappedRoles: ReadonlySet<string>): DirectoryMember | null {
  const roleIds = member.roleIds.filter((id) => mappedRoles.has(id));
  if (mappedRoles.has(guildId)) roleIds.push(guildId);
  return roleIds.length ? { ...member, roleIds } : null;
}

export function scopeDirectoryEvent(guildId: string, event: DirectoryEvent, mappedRoles: ReadonlySet<string>): DirectoryEvent {
  if (event.kind !== 'change') return event;
  const change = event.change;
  if (change.kind === 'upsert') {
    const member = accessRoleMember(guildId, change.member, mappedRoles);
    if (member) return { kind: 'change', revision: event.revision, change: { kind: 'upsert', member } };
    if (!change.previousRoleIds) return { kind: 'reset', revision: event.revision };
    if (change.previousRoleIds.some((id) => mappedRoles.has(id))) return { kind: 'change', revision: event.revision, change: { kind: 'remove', memberId: change.member.id } };
    return { kind: 'advance', revision: event.revision };
  }
  if (mappedRoles.has(guildId)) return { kind: 'change', revision: event.revision, change: { kind: 'remove', memberId: change.memberId } };
  if (!change.roleIds) return { kind: 'reset', revision: event.revision };
  return change.roleIds.some((id) => mappedRoles.has(id))
    ? { kind: 'change', revision: event.revision, change: { kind: 'remove', memberId: change.memberId } }
    : { kind: 'advance', revision: event.revision };
}
