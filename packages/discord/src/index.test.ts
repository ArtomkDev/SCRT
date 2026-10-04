import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationFlags, PermissionFlagsBits } from 'discord-api-types/v10';
import { administratorRoleIds, botDeleteChannel, botDeleteVoiceInterfaceMessage, botGuildMember, botGuildRoles, botPermissions, botPresenceIntentAvailable, botRenameVoiceChannel, canManageGuild, canMemberManageGuild, DiscordApiError, discordUser, effectiveBotPermissions, installAuthorizationUrl, installUrl, memberAvatarUrl, memberDisplayName, refreshTokens, requiredBotPermissions, type BotGuildMember } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('live installer permissions', () => {
  const guild = { id: 'guild', owner_id: 'owner' };
  const member = { user: { id: 'member', username: 'Member' }, roles: ['operator'] };
  it('accepts the owner, Manage Guild or Administrator and ignores unrelated roles', () => {
    expect(canMemberManageGuild(guild, { ...member, user: { ...member.user, id: 'owner' } }, [])).toBe(true);
    expect(canMemberManageGuild(guild, member, [{ id: 'operator', permissions: '32' }])).toBe(true);
    expect(canMemberManageGuild(guild, member, [{ id: 'operator', permissions: '8' }])).toBe(true);
    expect(canMemberManageGuild(guild, member, [{ id: 'other', permissions: '8' }])).toBe(false);
    expect(canMemberManageGuild(guild, { ...member, roles: [] }, [{ id: 'operator', permissions: '32' }])).toBe(false);
    expect(canMemberManageGuild(guild, member, [{ id: guild.id, permissions: '32' }])).toBe(true);
  });
});

describe('Discord API errors', () => {
  it('exposes the OAuth error code without reflecting provider descriptions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'secret refresh token' }), { status: 400 })));
    await expect(refreshTokens('client', 'secret', 'revoked')).rejects.toMatchObject({ status: 400, code: 'invalid_grant', message: 'Discord API failed (400) on POST /api/v10/oauth2/token' });
  });
  it('deletes channels through the bounded API client and accepts an empty 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(botDeleteChannel('delete-channel-token', '12345678901234567')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://discord.com/api/v10/channels/12345678901234567', expect.objectContaining({ method: 'DELETE', signal: expect.any(AbortSignal) }));
  });
  it('retries rate limited message deletion and treats already deleted messages as complete', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '0.001' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(botDeleteVoiceInterfaceMessage('delete-message-token', '12345678901234567', '22345678901234567')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('propagates delete permission and timeout failures without retrying an ambiguous write', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(botDeleteChannel('delete-denied', '12345678901234567')).rejects.toMatchObject({ status: 403 });
    await expect(botDeleteChannel('delete-timeout', '22345678901234567')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([0, ApplicationFlags.GatewayPresence, ApplicationFlags.GatewayPresenceLimited])('detects Presence availability for flags %d', async (flags) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ flags }), { status: 200 })));
    await expect(botPresenceIntentAvailable(`flags-${flags}`)).resolves.toBe(flags !== 0);
  });
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
  it('uses the response body when Discord omits the Retry-After header', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 0.001, global: true }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345678901234567', username: 'Tester' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(discordUser('body-retry-token')).resolves.toMatchObject({ username: 'Tester' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('honors a Retry-After value longer than ten seconds', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '11' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345678901234567', username: 'Tester' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const result = discordUser('long-retry-token');
      await vi.advanceTimersByTimeAsync(10_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ username: 'Tester' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('queues member reads on the same route before the next request reaches Discord', async () => {
    const firstMember = '12345678901234567';
    const secondMember = '22345678901234567';
    let finishFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { finishFirst = resolve; });
    const memberResponse = (id: string) => new Response(JSON.stringify({ roles: [], user: { id, username: 'Tester' } }), { status: 200 });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(memberResponse(secondMember));
    vi.stubGlobal('fetch', fetchMock);
    const first = botGuildMember('queue-bot-token', '32345678901234567', firstMember);
    const second = botGuildMember('queue-bot-token', '32345678901234567', secondMember);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finishFirst(memberResponse(firstMember));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
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

  it('releases an unread gateway error body before retrying', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    let releasedBeforeRetry = false;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 503 }))
      .mockImplementationOnce(async () => {
        releasedBeforeRetry = cancel.mock.calls.length === 1;
        return new Response(JSON.stringify({ id: '12345678901234567', username: 'Tester' }));
      });
    vi.stubGlobal('fetch', fetchMock);
    await expect(discordUser('gateway-body-release-token')).resolves.toMatchObject({ username: 'Tester' });
    expect(releasedBeforeRetry).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an excessive cooldown instead of waiting without a bound', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '60' } })));
    await expect(discordUser('excessive-cooldown')).rejects.toMatchObject({ status: 429 });
  });

  it('bounds the number of distinct pending member requests on one route', async () => {
    let finish!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => response.then(() => new Response(JSON.stringify({ roles: [], user: { id: '12345678901234567', username: 'Tester' } })))));
    const requests = Array.from({ length: 64 }, (_, i) => botGuildMember('bounded-bot', '62345678901234567', String(20000000000000000n + BigInt(i))));
    await expect(botGuildMember('bounded-bot', '62345678901234567', '99999999999999999')).rejects.toMatchObject({ status: 503 });
    finish(new Response());
    await Promise.all(requests);
  });

  it('keeps later requests behind an active call when a waiter times out', async () => {
    vi.useFakeTimers();
    try {
      const firstMember = '12345678901234567';
      let finish!: (response: Response) => void;
      const fetchMock = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
        .mockImplementation(async () => new Response(JSON.stringify({ roles: [], user: { id: firstMember, username: 'Tester' } })));
      vi.stubGlobal('fetch', fetchMock);
      const first = botGuildMember('timeout-queue-bot', '72345678901234567', firstMember);
      const timedOut = botGuildMember('timeout-queue-bot', '72345678901234567', '22345678901234567').catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(9_000);
      const later = botGuildMember('timeout-queue-bot', '72345678901234567', '32345678901234567');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await timedOut).toBeInstanceOf(Error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      finish(new Response(JSON.stringify({ roles: [], user: { id: firstMember, username: 'Tester' } })));
      await expect(Promise.all([first, later])).resolves.toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('runs an interactive access check ahead of queued profile reads without overlapping calls', async () => {
    let finish!: (response: Response) => void;
    const body = JSON.stringify({ roles: [], user: { id: '12345678901234567', username: 'Tester' } });
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockImplementation(async () => new Response(body));
    vi.stubGlobal('fetch', fetchMock);
    const ids = ['12345678901234567', '22345678901234567', '32345678901234567', '42345678901234567'];
    const requests = ids.map((id, index) => botGuildMember('priority-bot', '82345678901234567', id, index === 3 ? { priority: 'interactive' } : undefined));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish(new Response(body));
    await Promise.all(requests);
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([ids[0], ids[3], ids[1], ids[2]]);
  });

  it('promotes an existing queued profile read when authorization needs the same member', async () => {
    let finish!: (response: Response) => void;
    const body = JSON.stringify({ roles: [], user: { id: '12345678901234567', username: 'Tester' } });
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockImplementation(async () => new Response(body));
    vi.stubGlobal('fetch', fetchMock);
    const ids = ['12345678901234567', '22345678901234567', '32345678901234567'];
    const requests = ids.map((id) => botGuildMember('promoted-priority-bot', '82345678901234567', id));
    const promoted = botGuildMember('promoted-priority-bot', '82345678901234567', ids[2]!, { priority: 'interactive' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish(new Response(body));
    await Promise.all([...requests, promoted]);
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([ids[0], ids[2], ids[1]]);
  });

  it('allows normal reads to progress during a run of interactive checks', async () => {
    let finish!: (response: Response) => void;
    const body = JSON.stringify({ roles: [], user: { id: '12345678901234567', username: 'Tester' } });
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockImplementation(async () => new Response(body));
    vi.stubGlobal('fetch', fetchMock);
    const guildId = '82345678901234567';
    const first = botGuildMember('fair-priority-bot', guildId, '12345678901234567');
    const normal = botGuildMember('fair-priority-bot', guildId, '22345678901234567');
    const interactive = Array.from({ length: 5 }, (_, index) => botGuildMember('fair-priority-bot', guildId, String(30000000000000000n + BigInt(index)), { priority: 'interactive' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish(new Response(body));
    await Promise.all([first, normal, ...interactive]);
    expect(String(fetchMock.mock.calls[5]![0])).toContain('/members/22345678901234567');
  });
});

describe('guild member identity', () => {
  const member: BotGuildMember = { roles: [], nick: 'Серверний нік', avatar: 'guildhash', user: { id: '12345678901234567', username: 'account', global_name: 'Профіль', avatar: 'userhash' } };
  it('prefers the server nickname and server avatar', () => {
    expect(memberDisplayName(member)).toBe('Серверний нік');
    expect(memberAvatarUrl('22345678901234567', member)).toContain('/guilds/22345678901234567/users/12345678901234567/avatars/guildhash.webp');
  });
  it('falls back to the account profile and default avatar', () => {
    expect(memberDisplayName({ ...member, nick: null })).toBe('Профіль');
    expect(memberAvatarUrl('22345678901234567', { ...member, avatar: null })).toContain('/avatars/12345678901234567/userhash.webp');
    expect(memberAvatarUrl('22345678901234567', { ...member, avatar: null, user: { ...member.user, avatar: null } })).toMatch(/\/embed\/avatars\/[0-5]\.png$/);
  });
});

describe('Discord role appearance', () => {
  it('retains hierarchy, role icon, and enhanced gradient colors', async () => {
    const role = { id: '22345678901234567', name: 'Moderator', permissions: '0', position: 8, color: 123, colors: { primary_color: 123, secondary_color: 456, tertiary_color: 789 }, icon: 'hash', unicode_emoji: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([role]), { status: 200 })));
    await expect(botGuildRoles('bot-token', '12345678901234567')).resolves.toEqual([role]);
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
  it('binds advanced bot authorization to the selected guild and callback', () => {
    const url = new URL(installAuthorizationUrl('12345678901234567', guild.id, 'https://scrt.example/api/auth/callback', 'state', 'challenge'));
    expect(url.searchParams.get('scope')).toBe('bot applications.commands identify');
    expect(url.searchParams.get('guild_id')).toBe(guild.id);
    expect(url.searchParams.get('disable_guild_select')).toBe('true');
    expect(url.searchParams.get('integration_type')).toBe('0');
    expect(url.searchParams.get('redirect_uri')).toBe('https://scrt.example/api/auth/callback');
    expect(url.searchParams.get('state')).toBe('state');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('permissions')).toBe(botPermissions.toString());
  });
  it('selects only roles with Discord Administrator', () => {
    expect(administratorRoleIds([{ id: 'one', permissions: '8' }, { id: 'two', permissions: '32' }, { id: 'three', permissions: '40' }])).toEqual(['one', 'three']);
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
