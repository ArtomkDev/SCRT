import { describe, expect, it } from 'vitest';
import { canEditAccessGrant, PermissionService, resolvePermissions } from './index';

const base = { guildId: 'guild', userId: 'user', ownerId: 'owner', discordRoleIds: [] as string[], mappings: [], memberMappings: [] };
describe('guild permissions', () => {
  it('keeps Activity management separate from viewing and respects live roles', () => {
    const viewer = { ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'VIEWER' as const }] };
    expect(resolvePermissions(viewer).has('activity.view')).toBe(true);
    expect(resolvePermissions(viewer).has('activity.manage')).toBe(false);
    const admin = { ...viewer, mappings: [{ discordRoleId: '123', appRole: 'ADMIN' as const }] };
    expect(resolvePermissions(admin).has('activity.manage')).toBe(true);
    expect(resolvePermissions({ ...admin, discordRoleIds: [] }).has('activity.manage')).toBe(false);
    expect(resolvePermissions({ ...base, userId: 'owner' }).has('activity.manage')).toBe(true);
    expect(() => new PermissionService().require(base, 'activity.view')).toThrow('Forbidden');
  });
  it('gives level three access management through personal and role grants', () => {
    expect(resolvePermissions({ ...base, memberMappings: [{ discordUserId: 'user', appRole: 'SUPER_ADMIN' }] }).has('settings.manage')).toBe(true);
    expect(resolvePermissions({ ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'SUPER_ADMIN' }] }).has('settings.manage')).toBe(true);
  });
  it('keeps owner super admin even without role mappings', () => expect(resolvePermissions({ ...base, userId: 'owner' }).has('settings.manage')).toBe(true));
  it('denies unrelated guild members', () => expect(() => new PermissionService().require(base, 'dashboard.access')).toThrow('Forbidden'));
  it('resolves mapped roles', () => expect(resolvePermissions({ ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'VIEWER' }] }).has('activity.view')).toBe(true));
  it('does not give viewer write permissions', () => expect(resolvePermissions({ ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'VIEWER' }] }).has('settings.manage')).toBe(false));
  it('grants @everyone viewing without an explicit member role', () => {
    const granted = resolvePermissions({ ...base, mappings: [{ discordRoleId: base.guildId, appRole: 'VIEWER' }] });
    expect(granted.has('settings.view')).toBe(true);
    expect(granted.has('voice.manage')).toBe(false);
    expect(resolvePermissions({ ...base, mappings: [{ discordRoleId: base.guildId, appRole: 'ADMIN' }] }).has('voice.manage')).toBe(false);
  });
  it('allows a mapped admin to configure the bot without access management', () => {
    const granted = resolvePermissions({ ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'ADMIN' }] });
    expect(granted.has('voice.manage')).toBe(true);
    expect(granted.has('settings.manage')).toBe(false);
  });
  it('does not infer SCRT rights from Discord permissions', () => {
    expect(resolvePermissions(base).has('voice.manage')).toBe(false);
  });
  it('grants a selected member access without a mapped role', () => {
    const granted = resolvePermissions({ ...base, memberMappings: [{ discordUserId: 'user', appRole: 'ADMIN' }] });
    expect(granted.has('voice.manage')).toBe(true);
    expect(granted.has('settings.manage')).toBe(false);
  });
  it('does not grant another member or let a viewer override an admin role', () => {
    expect(resolvePermissions({ ...base, memberMappings: [{ discordUserId: 'other', appRole: 'ADMIN' }] }).size).toBe(0);
    const granted = resolvePermissions({ ...base, discordRoleIds: ['123'], mappings: [{ discordRoleId: '123', appRole: 'ADMIN' }], memberMappings: [{ discordUserId: 'user', appRole: 'VIEWER' }] });
    expect(granted.has('voice.manage')).toBe(true);
  });
});

describe('protected grants', () => {
  it('allows only the owner or issuer to edit full access, including their own entry', () => {
    const grant = { appRole: 'SUPER_ADMIN' as const, grantedBy: 'issuer' };
    expect(canEditAccessGrant({ userId: 'current-owner', isOwner: true }, grant)).toBe(true);
    expect(canEditAccessGrant({ userId: 'issuer', isOwner: false }, grant)).toBe(true);
    expect(canEditAccessGrant({ userId: 'peer', isOwner: false }, grant)).toBe(false);
    expect(canEditAccessGrant({ userId: 'peer', isOwner: false }, { appRole: 'SUPER_ADMIN' })).toBe(false);
    expect(canEditAccessGrant({ userId: 'peer', isOwner: false }, { appRole: 'ADMIN', grantedBy: 'issuer' })).toBe(true);
  });
});
