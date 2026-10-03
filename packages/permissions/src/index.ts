export const permissions = ['dashboard.access', 'members.view', 'members.manage', 'activity.view', 'activity.manage', 'voice.view', 'voice.manage', 'moderation.view', 'moderation.manage', 'automation.view', 'automation.manage', 'logs.view', 'settings.view', 'settings.manage'] as const;
export type AppPermission = typeof permissions[number];
export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';
export type AccessGrant = { appRole: AppRole; grantedBy?: string };
export type RoleMapping = AccessGrant & { discordRoleId: string };
export type MemberMapping = AccessGrant & { discordUserId: string };
export type AccessMappings = { roles: readonly RoleMapping[]; members: readonly MemberMapping[] };
// Constructed on the server from live Discord facts, never from submitted form fields.
export type AccessActor = { guildId: string; userId: string; isOwner: boolean; discordRoleIds: readonly string[] };

export function canEditAccessGrant(actor: Pick<AccessActor, 'userId' | 'isOwner'>, grant?: AccessGrant): boolean {
  return actor.isOwner || grant?.appRole !== 'SUPER_ADMIN' || grant.grantedBy === actor.userId;
}

export function requireAccessGrantEditor(actor: AccessActor, mappings: AccessMappings, grant?: AccessGrant): void {
  new PermissionService().require({ guildId: actor.guildId, userId: actor.userId, ownerId: actor.isOwner ? actor.userId : '', discordRoleIds: actor.discordRoleIds, mappings: mappings.roles, memberMappings: mappings.members }, 'settings.manage');
  if (!canEditAccessGrant(actor, grant)) throw new Error('Цей повний доступ може змінити лише власник сервера або той, хто його надав.');
}

const rolePermissions: Record<AppRole, readonly AppPermission[]> = {
  SUPER_ADMIN: permissions,
  ADMIN: permissions.filter((value) => value !== 'settings.manage'),
  VIEWER: ['dashboard.access', 'members.view', 'activity.view', 'voice.view', 'logs.view', 'settings.view'],
};

export function permissionsForRole(role: AppRole): readonly AppPermission[] {
  return rolePermissions[role];
}

export function resolvePermissions(input: { guildId: string; userId: string; ownerId: string; discordRoleIds: readonly string[]; mappings: readonly RoleMapping[]; memberMappings: readonly MemberMapping[] }): Set<AppPermission> {
  if (input.userId === input.ownerId) return new Set(permissions);
  const result = new Set<AppPermission>();
  for (const mapping of input.mappings) if (mapping.discordRoleId === input.guildId || input.discordRoleIds.includes(mapping.discordRoleId)) {
    for (const permission of rolePermissions[mapping.discordRoleId === input.guildId ? 'VIEWER' : mapping.appRole]) result.add(permission);
  }
  for (const mapping of input.memberMappings) if (mapping.discordUserId === input.userId) {
    for (const permission of rolePermissions[mapping.appRole]) result.add(permission);
  }
  return result;
}

export class PermissionService {
  permissionsFor = resolvePermissions;
  require(input: Parameters<typeof resolvePermissions>[0], permission: AppPermission): void {
    if (!resolvePermissions(input).has(permission)) throw new Error('Forbidden');
  }
}
