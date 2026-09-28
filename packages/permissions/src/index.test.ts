import { describe, expect, it } from 'vitest';
import { PermissionService, resolvePermissions } from './index';

const base = { userId: 'user', ownerId: 'owner', discordRoleIds: [] as string[], mappings: [], hasManageGuild: false };
describe('guild permissions', () => {
  it('keeps owner super admin even without role mappings', () => expect(resolvePermissions({ ...base, userId: 'owner' }).has('settings.manage')).toBe(true));
  it('denies unrelated guild members', () => expect(() => new PermissionService().require(base, 'dashboard.access')).toThrow('Forbidden'));
  it('resolves mapped roles', () => expect(resolvePermissions({ ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'VIEWER' }] }).has('activity.view')).toBe(true));
  it('does not give viewer write permissions', () => expect(resolvePermissions({ ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'VIEWER' }] }).has('settings.manage')).toBe(false));
});
