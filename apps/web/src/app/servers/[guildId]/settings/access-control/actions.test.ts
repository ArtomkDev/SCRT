import { beforeEach, describe, expect, it, vi } from 'vitest';

const guildId = '22345678901234567';
const roleId = '32345678901234567';
const userId = '42345678901234567';
const actor = { guildId, userId: '12345678901234567', isOwner: true, discordRoleIds: [] };
const mocks = vi.hoisted(() => ({ requireGuildAccess: vi.fn(), botGuildRoles: vi.fn(), botGuild: vi.fn(), botGuildMember: vi.fn(), setRoleMapping: vi.fn(), removeRoleMapping: vi.fn(), setMemberMapping: vi.fn(), removeMemberMapping: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('@/lib/server', () => ({ env: () => ({ DISCORD_BOT_TOKEN: 'token' }), guilds: () => ({ setRoleMapping: mocks.setRoleMapping, removeRoleMapping: mocks.removeRoleMapping, setMemberMapping: mocks.setMemberMapping, removeMemberMapping: mocks.removeMemberMapping }) }));
vi.mock('@scrt/discord', () => ({ botGuildRoles: mocks.botGuildRoles, botGuild: mocks.botGuild, botGuildMember: mocks.botGuildMember }));

import { removeAccessMember, removeAccessRole, saveAccessMember, saveAccessRole } from './actions';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('access role actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireGuildAccess.mockResolvedValue({ accessActor: actor });
    mocks.botGuildRoles.mockResolvedValue([{ id: guildId, name: '@everyone' }, { id: roleId, name: 'Operators' }]);
    mocks.botGuild.mockResolvedValue({ owner_id: '12345678901234567' });
    mocks.botGuildMember.mockResolvedValue({ user: { id: userId, username: 'Member', bot: false } });
  });

  it('lets the owner grant an existing Discord role', async () => {
    await saveAccessRole(guildId, form({ roleId, appRole: 'ADMIN' }));
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(guildId, 'settings.manage');
    expect(mocks.setRoleMapping).toHaveBeenCalledWith(guildId, roleId, 'ADMIN', actor);
  });

  it('rejects users without settings.manage', async () => {
    mocks.requireGuildAccess.mockRejectedValue(new Error('Forbidden'));
    await expect(saveAccessRole(guildId, form({ roleId, appRole: 'ADMIN' }))).rejects.toThrow('Forbidden');
    await expect(removeAccessRole(guildId, form({ roleId }))).rejects.toThrow('Forbidden');
    expect(mocks.setRoleMapping).not.toHaveBeenCalled();
    expect(mocks.removeRoleMapping).not.toHaveBeenCalled();
  });

  it('allows @everyone only for viewing and rejects unknown roles', async () => {
    await saveAccessRole(guildId, form({ roleId: guildId, appRole: 'VIEWER' }));
    expect(mocks.setRoleMapping).toHaveBeenCalledWith(guildId, guildId, 'VIEWER', actor);
    mocks.setRoleMapping.mockClear();
    await expect(saveAccessRole(guildId, form({ roleId: guildId, appRole: 'ADMIN' }))).rejects.toThrow('@everyone supports viewing only');
    await expect(saveAccessRole(guildId, form({ roleId: '42345678901234567', appRole: 'ADMIN' }))).rejects.toThrow('Invalid Discord role');
    expect(mocks.setRoleMapping).not.toHaveBeenCalled();
  });

  it('rejects a forged access level', async () => {
    await expect(saveAccessRole(guildId, form({ roleId, appRole: 'OWNER' }))).rejects.toThrow('Invalid access level');
    expect(mocks.setRoleMapping).not.toHaveBeenCalled();
  });
  it('lets the owner grant access to a current guild member', async () => {
    await saveAccessMember(guildId, form({ userId, appRole: 'ADMIN' }));
    expect(mocks.botGuildMember).toHaveBeenCalledWith('token', guildId, userId);
    expect(mocks.setMemberMapping).toHaveBeenCalledWith(guildId, userId, 'ADMIN', actor);
  });
  it('does not let a user without settings.manage change personal access', async () => {
    mocks.requireGuildAccess.mockRejectedValue(new Error('Forbidden'));
    await expect(saveAccessMember(guildId, form({ userId, appRole: 'ADMIN' }))).rejects.toThrow('Forbidden');
    await expect(removeAccessMember(guildId, form({ userId }))).rejects.toThrow('Forbidden');
    expect(mocks.setMemberMapping).not.toHaveBeenCalled();
  });
  it('does not grant access to the owner, a bot, or a forged access level', async () => {
    await expect(saveAccessMember(guildId, form({ userId: '12345678901234567', appRole: 'ADMIN' }))).rejects.toThrow('Invalid access member');
    mocks.botGuildMember.mockResolvedValue({ user: { id: userId, username: 'Bot', bot: true } });
    await expect(saveAccessMember(guildId, form({ userId, appRole: 'ADMIN' }))).rejects.toThrow('Invalid access member');
    await expect(saveAccessMember(guildId, form({ userId, appRole: 'OWNER' }))).rejects.toThrow('Invalid access level');
    expect(mocks.setMemberMapping).not.toHaveBeenCalled();
  });
  it('does not persist a member when Discord cannot confirm guild membership', async () => {
    mocks.botGuildMember.mockRejectedValue(new Error('Discord member missing'));
    await expect(saveAccessMember(guildId, form({ userId, appRole: 'ADMIN' }))).rejects.toThrow('Discord member missing');
    expect(mocks.setMemberMapping).not.toHaveBeenCalled();
  });

  it('lets a super admin grant level three using only the authenticated actor', async () => {
    const superAdmin = { ...actor, userId: '52345678901234567', isOwner: false, discordRoleIds: [roleId] };
    mocks.requireGuildAccess.mockResolvedValue({ accessActor: superAdmin });
    await saveAccessRole(guildId, form({ roleId, appRole: 'SUPER_ADMIN', grantedBy: userId, isOwner: 'true' }));
    await saveAccessMember(guildId, form({ userId, appRole: 'SUPER_ADMIN', grantedBy: userId }));
    expect(mocks.setRoleMapping).toHaveBeenCalledWith(guildId, roleId, 'SUPER_ADMIN', superAdmin);
    expect(mocks.setMemberMapping).toHaveBeenCalledWith(guildId, userId, 'SUPER_ADMIN', superAdmin);
  });

  it('passes the authenticated actor to removals and propagates transaction protection', async () => {
    mocks.removeMemberMapping.mockRejectedValue(new Error('Protected access'));
    await expect(removeAccessMember(guildId, form({ userId }))).rejects.toThrow('Protected access');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.removeMemberMapping).toHaveBeenCalledWith(guildId, userId, actor);
    await removeAccessRole(guildId, form({ roleId }));
    expect(mocks.removeRoleMapping).toHaveBeenCalledWith(guildId, roleId, actor);
  });
});
