export const permissions = ['dashboard.access', 'members.view', 'members.manage', 'activity.view', 'voice.view', 'voice.manage', 'moderation.view', 'moderation.manage', 'automation.view', 'automation.manage', 'logs.view', 'settings.view', 'settings.manage'] as const;
export type AppPermission = typeof permissions[number];
export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';
export type RoleMapping = { discordRoleId: string; appRole: AppRole };

const rolePermissions: Record<AppRole, readonly AppPermission[]> = {
  SUPER_ADMIN: permissions,
  ADMIN: permissions.filter((value) => value !== 'settings.manage'),
  VIEWER: ['dashboard.access', 'members.view', 'activity.view', 'voice.view', 'logs.view', 'settings.view'],
};

export function permissionsForRole(role: AppRole): readonly AppPermission[] {
  return rolePermissions[role];
}

export function resolvePermissions(input: { userId: string; ownerId: string; discordRoleIds: readonly string[]; mappings: readonly RoleMapping[]; hasManageGuild: boolean }): Set<AppPermission> {
  if (input.userId === input.ownerId) return new Set(permissions);
  const result = new Set<AppPermission>();
  if (input.hasManageGuild) for (const permission of rolePermissions.ADMIN) result.add(permission);
  for (const mapping of input.mappings) if (input.discordRoleIds.includes(mapping.discordRoleId)) {
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
