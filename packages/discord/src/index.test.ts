import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { botPermissions, botRenameVoiceChannel, canManageGuild, DiscordApiError, discordUser, effectiveBotPermissions, installUrl, requiredBotPermissions } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('Discord API errors', () => {
  it('preserves the response status for an expired user token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(discordUser('expired')).rejects.toMatchObject({ name: 'DiscordApiError', status: 401 });
    expect(new DiscordApiError(401).message).toBe('Discord API failed (401)');
  });
  it('coalesces simultaneous reads of the same endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '12345678901234567', username: 'Tester' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const [first, second] = await Promise.all([discordUser('shared-token'), discordUser('shared-token')]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('waits for Retry-After before retrying a throttled read', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '0.001' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345678901234567', username: 'Tester' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(discordUser('retry-token')).resolves.toMatchObject({ username: 'Tester' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('retries a temporary Discord gateway failure on a read', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345678901234567', username: 'Tester' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(discordUser('gateway-retry-token')).resolves.toMatchObject({ username: 'Tester' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('voice channel updates', () => {
  it('sends only the new channel name to Discord', async () => {
    const channelId = '22345678901234567';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: channelId, type: 2, name: 'Новий Creator' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await botRenameVoiceChannel('bot-token', channelId, 'Новий Creator');
    expect(fetchMock).toHaveBeenCalledWith(`https://discord.com/api/v10/channels/${channelId}`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Новий Creator' }) }));
  });
});

const guild = { id: '12345678901234567', name: 'Test', icon: null, owner: false, permissions: '0' };
describe('Discord guild selection', () => {
  it('allows server owners and Manage Server permission', () => {
    expect(canManageGuild({ ...guild, owner: true })).toBe(true);
    expect(canManageGuild({ ...guild, permissions: '32' })).toBe(true);
    expect(canManageGuild({ ...guild, permissions: '8' })).toBe(true);
    expect(canManageGuild(guild)).toBe(false);
  });
  it('requests the canonical Voice permissions', () => {
    const url = new URL(installUrl('12345678901234567', guild.id));
    expect(url.searchParams.get('permissions')).toBe(botPermissions.toString());
    for (const permission of requiredBotPermissions) expect((botPermissions & permission) === permission).toBe(true);
    expect(url.searchParams.get('guild_id')).toBe(guild.id);
  });
});

describe('bot permission health', () => {
  it('accounts for role and member channel overwrites', () => {
    const guildId = '12345678901234567';
    const roleId = '22345678901234567';
    const botId = '32345678901234567';
    const roles = [{ id: guildId, name: '@everyone', permissions: (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect).toString() }, { id: roleId, name: 'SCRT', permissions: '0' }];
    const channel = { id: '42345678901234567', type: 2, permission_overwrites: [{ id: roleId, type: 0, allow: '0', deny: PermissionFlagsBits.Connect.toString() }] };
    const denied = effectiveBotPermissions(guildId, [roleId], roles, channel, botId);
    expect((denied & PermissionFlagsBits.Connect) === 0n).toBe(true);
    const allowed = effectiveBotPermissions(guildId, [roleId], roles, { ...channel, permission_overwrites: [...channel.permission_overwrites, { id: botId, type: 1, allow: PermissionFlagsBits.Connect.toString(), deny: '0' }] }, botId);
    expect((allowed & PermissionFlagsBits.Connect) !== 0n).toBe(true);
  });
});
