import { describe, expect, it } from 'vitest';
import { GuildRepository } from './index';
import type { AccessActor } from '@scrt/permissions';

type Row = Record<string, unknown>;
function repository() {
  const rows = new Map<string, Row>();
  const ref = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => snapshot(path),
  });
  const snapshot = (path: string) => ({ exists: rows.has(path), get: (field: string) => rows.get(path)?.[field] });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(task: (transaction: {
      get: (document: { path: string }) => Promise<ReturnType<typeof snapshot>>;
      set: (document: { path: string }, value: Row, options?: { merge?: boolean }) => void;
    }) => Promise<T>) => task({
      get: async (document) => snapshot(document.path),
      set: (document, value, options) => rows.set(document.path, options?.merge ? { ...rows.get(document.path), ...value } : value),
    }),
  };
  return { rows, repository: new GuildRepository(db as unknown as ConstructorParameters<typeof GuildRepository>[0]) };
}

const guildId = '123456789012345678';
const adminRole = '223456789012345678';
const otherRole = '323456789012345678';
const installerId = '423456789012345678';
const guild = { guildId, name: 'Server', icon: null, ownerId: '523456789012345678' };
const accessPath = `guilds/${guildId}/access/roles`;

describe('installation access defaults', () => {
  it('adds @everyone viewer and every Administrator role once', async () => {
    const { rows, repository: repo } = repository();
    await repo.upsertInstalled(guild, [adminRole, adminRole, otherRole]);
    expect(rows.get(accessPath)?.mappings).toEqual([
      { discordRoleId: guildId, appRole: 'VIEWER' },
      { discordRoleId: adminRole, appRole: 'SUPER_ADMIN', grantedBy: guild.ownerId },
      { discordRoleId: otherRole, appRole: 'SUPER_ADMIN', grantedBy: guild.ownerId },
    ]);
    await repo.upsertInstalled(guild, []);
    expect(rows.get(accessPath)?.mappings).toHaveLength(3);
  });

  it('preserves existing access choices when a bot reconnects', async () => {
    const { rows, repository: repo } = repository();
    const custom = [{ discordRoleId: otherRole, appRole: 'VIEWER' }];
    rows.set(accessPath, { mappings: custom, members: [] });
    await repo.upsertInstalled(guild, [adminRole]);
    expect(rows.get(accessPath)?.mappings).toEqual(custom);
  });

  it('grants the installer once even if the OAuth callback precedes the gateway event', async () => {
    const { rows, repository: repo } = repository();
    await repo.grantInstallerAccess(guildId, installerId, [adminRole], guild.ownerId);
    await repo.upsertInstalled(guild, [adminRole]);
    await repo.grantInstallerAccess(guildId, installerId, [adminRole], guild.ownerId);
    expect(rows.get(accessPath)?.mappings).toEqual([
      { discordRoleId: guildId, appRole: 'VIEWER' }, { discordRoleId: adminRole, appRole: 'SUPER_ADMIN', grantedBy: guild.ownerId },
    ]);
    expect(rows.get(accessPath)?.members).toEqual([{ discordUserId: installerId, appRole: 'SUPER_ADMIN', grantedBy: guild.ownerId }]);
  });

  it('never adds the installing owner and removes their legacy personal entry', async () => {
    const { rows, repository: repo } = repository();
    await repo.grantInstallerAccess(guildId, guild.ownerId, [adminRole], guild.ownerId);
    expect(rows.get(accessPath)?.members).toEqual([]);
    rows.set(accessPath, { ...rows.get(accessPath), members: [{ discordUserId: guild.ownerId, appRole: 'ADMIN' }, { discordUserId: installerId, appRole: 'VIEWER' }] });
    await repo.grantInstallerAccess(guildId, guild.ownerId, [adminRole], guild.ownerId);
    expect(rows.get(accessPath)?.members).toEqual([{ discordUserId: installerId, appRole: 'VIEWER' }]);
  });
});

describe('transactional access management', () => {
  const creatorId = '623456789012345678';
  const targetId = '723456789012345678';
  const owner: AccessActor = { guildId, userId: guild.ownerId, isOwner: true, discordRoleIds: [] };
  const creator: AccessActor = { guildId, userId: creatorId, isOwner: false, discordRoleIds: [] };
  const peer: AccessActor = { guildId, userId: installerId, isOwner: false, discordRoleIds: [] };
  const setup = () => {
    const result = repository();
    result.rows.set(accessPath, {
      mappings: [{ discordRoleId: adminRole, appRole: 'SUPER_ADMIN', grantedBy: creatorId }],
      members: [
        { discordUserId: creatorId, appRole: 'SUPER_ADMIN', grantedBy: guild.ownerId },
        { discordUserId: installerId, appRole: 'SUPER_ADMIN', grantedBy: guild.ownerId },
        { discordUserId: targetId, appRole: 'SUPER_ADMIN', grantedBy: creatorId },
      ],
    });
    return result;
  };

  it('prevents peer deletion, demotion and no-op takeover of both role and personal grants', async () => {
    const { rows, repository: repo } = setup();
    const before = structuredClone(rows.get(accessPath));
    await expect(repo.removeRoleMapping(guildId, adminRole, peer)).rejects.toThrow('лише власник');
    await expect(repo.setRoleMapping(guildId, adminRole, 'VIEWER', peer)).rejects.toThrow('лише власник');
    await expect(repo.setRoleMapping(guildId, adminRole, 'SUPER_ADMIN', peer)).rejects.toThrow('лише власник');
    await expect(repo.removeMemberMapping(guildId, targetId, peer)).rejects.toThrow('лише власник');
    await expect(repo.setMemberMapping(guildId, targetId, 'ADMIN', peer)).rejects.toThrow('лише власник');
    await expect(repo.setMemberMapping(guildId, targetId, 'SUPER_ADMIN', peer)).rejects.toThrow('лише власник');
    expect(rows.get(accessPath)).toEqual(before);
  });

  it.each([owner, creator])('lets owner or grantor demote and remove their protected grants: $userId', async (actor) => {
    const { rows, repository: repo } = setup();
    await repo.setRoleMapping(guildId, adminRole, 'ADMIN', actor);
    await repo.setMemberMapping(guildId, targetId, 'VIEWER', actor);
    expect(rows.get(accessPath)?.mappings).toEqual([{ discordRoleId: adminRole, appRole: 'ADMIN', grantedBy: actor.userId }]);
    await repo.removeRoleMapping(guildId, adminRole, actor);
    await repo.removeMemberMapping(guildId, targetId, actor);
    expect(rows.get(accessPath)?.mappings).toEqual([]);
    expect((rows.get(accessPath)?.members as { discordUserId: string }[]).some((entry) => entry.discordUserId === targetId)).toBe(false);
  });

  it.each([owner, creator])('lets owner or grantor directly remove full access: $userId', async (actor) => {
    const { repository: repo } = setup();
    await expect(repo.removeRoleMapping(guildId, adminRole, actor)).resolves.toBeUndefined();
    await expect(repo.removeMemberMapping(guildId, targetId, actor)).resolves.toBeUndefined();
  });

  it('records the actor on promotion and preserves the grantor on an owner no-op', async () => {
    const { rows, repository: repo } = setup();
    await repo.setRoleMapping(guildId, otherRole, 'SUPER_ADMIN', creator);
    await repo.setRoleMapping(guildId, otherRole, 'SUPER_ADMIN', owner);
    expect(rows.get(accessPath)?.mappings).toContainEqual({ discordRoleId: otherRole, appRole: 'SUPER_ADMIN', grantedBy: creatorId });
    await repo.setMemberMapping(guildId, targetId, 'SUPER_ADMIN', owner);
    expect(rows.get(accessPath)?.members).toContainEqual({ discordUserId: targetId, appRole: 'SUPER_ADMIN', grantedBy: creatorId });
  });

  it('rechecks actor permissions inside the transaction after their access was revoked', async () => {
    const { rows, repository: repo } = setup();
    rows.set(accessPath, { ...rows.get(accessPath), members: [{ discordUserId: creatorId, appRole: 'ADMIN' }] });
    await expect(repo.removeRoleMapping(guildId, adminRole, creator)).rejects.toThrow('Forbidden');
    await expect(repo.setMemberMapping(guildId, targetId, 'SUPER_ADMIN', creator)).rejects.toThrow('Forbidden');
  });

  it('checks the current target grant, not a stale editable snapshot from the page', async () => {
    const { rows, repository: repo } = setup();
    await repo.setRoleMapping(guildId, otherRole, 'VIEWER', owner);
    await repo.setRoleMapping(guildId, otherRole, 'SUPER_ADMIN', creator);
    await expect(repo.removeRoleMapping(guildId, otherRole, peer)).rejects.toThrow('лише власник');
    expect(rows.get(accessPath)?.mappings).toContainEqual({ discordRoleId: otherRole, appRole: 'SUPER_ADMIN', grantedBy: creatorId });
  });

  it('resolves a role-based super admin and forbids writes in another guild', async () => {
    const { repository: repo } = setup();
    const roleActor = { guildId, userId: '823456789012345678', isOwner: false, discordRoleIds: [adminRole] };
    await repo.setRoleMapping(guildId, otherRole, 'ADMIN', roleActor);
    await expect(repo.setRoleMapping(guildId, otherRole, 'ADMIN', { ...owner, guildId: '823456789012345678' })).rejects.toThrow('Forbidden');
    await expect(repo.setRoleMapping(guildId, guildId, 'SUPER_ADMIN', owner)).rejects.toThrow('@everyone');
  });

  it('reserves legacy full grants with no grantor for the current owner', async () => {
    const { rows, repository: repo } = setup();
    rows.set(accessPath, { ...rows.get(accessPath), mappings: [{ discordRoleId: adminRole, appRole: 'SUPER_ADMIN' }] });
    await expect(repo.removeRoleMapping(guildId, adminRole, creator)).rejects.toThrow('лише власник');
    await repo.removeRoleMapping(guildId, adminRole, owner);
  });

  it('records who issued personal full access and protects it from other admins', async () => {
    const { rows, repository: repo } = setup();
    const memberId = '823456789012345678';
    await repo.setMemberMapping(guildId, memberId, 'SUPER_ADMIN', creator);
    expect(rows.get(accessPath)?.members).toContainEqual({ discordUserId: memberId, appRole: 'SUPER_ADMIN', grantedBy: creatorId });
    await expect(repo.removeMemberMapping(guildId, memberId, peer)).rejects.toThrow('лише власник');
    await expect(repo.removeMemberMapping(guildId, memberId, creator)).resolves.toBeUndefined();
  });
});
