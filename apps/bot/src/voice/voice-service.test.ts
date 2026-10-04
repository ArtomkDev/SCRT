import { describe, expect, it, vi } from 'vitest';
import { ChannelType, type Client, type Guild, type GuildMember, type VoiceState } from 'discord.js';
import type { GuildRepository, VoiceRepository } from '@scrt/database';
import { voiceCreatorSchema, voiceRoomSchema, voiceSettingsSchema, type VoiceRoom } from '@scrt/validation';
import { VoiceService } from './voice-service';

const guildId = '12345678901234567';
const creatorId = '22345678901234567';
const roomId = '32345678901234567';
const userId = '42345678901234567';
const creator = voiceCreatorSchema.parse({ id: creatorId, guildId, channelId: creatorId, interfaceMode: 'none' });

function harness(overrides: { enabled?: boolean; bot?: boolean; moveFails?: boolean; positionFails?: boolean; roomPlacement?: 'above' | 'below' | 'top' | 'bottom'; roomOrder?: 'oldest_first' | 'newest_first'; maxRoomsPerUser?: number; cleanupDelaySeconds?: number; duplicateRoomPolicy?: 'reuse' | 'allow'; ownerLeaveGraceSeconds?: number } = {}) {
  const configuredCreator = { ...creator, roomPlacement: overrides.roomPlacement ?? creator.roomPlacement, roomOrder: overrides.roomOrder ?? creator.roomOrder };
  const settings = voiceSettingsSchema.parse({ enabled: overrides.enabled ?? true, defaultInterfaceMode: 'none', maxRoomsPerUser: overrides.maxRoomsPerUser ?? 1, cleanupDelaySeconds: overrides.cleanupDelaySeconds ?? 0, duplicateRoomPolicy: overrides.duplicateRoomPolicy ?? 'reuse', ownerLeaveGraceSeconds: overrides.ownerLeaveGraceSeconds ?? 0 });
  const rooms = new Map<string, VoiceRoom>();
  const members = new Map<string, unknown>();
  const deleteChannel = vi.fn(async () => undefined);
  const setPosition = vi.fn(async () => { if (overrides.positionFails) throw new Error('Position failed'); });
  const channel = { id: roomId, type: ChannelType.GuildVoice, parentId: null, position: 1, parent: null, members, permissionOverwrites: { cache: new Map(), set: vi.fn(async () => undefined) }, setPosition, delete: deleteChannel };
  const source = { id: creatorId, type: ChannelType.GuildVoice, parentId: null, position: 0, permissionOverwrites: { cache: new Map() }, permissionsFor: () => ({ has: () => true }) };
  const cache = new Map<string, unknown>([[creatorId, source], [roomId, channel]]);
  const create = vi.fn(async () => channel);
  const guild = { id: guildId, ownerId: '52345678901234567', maximumBitrate: 96000, members: { me: { id: '62345678901234567' } }, channels: { cache, create } } as unknown as Guild;
  const member = { id: userId, guild, user: { bot: overrides.bot ?? false, username: 'user' }, displayName: 'User', voice: { channelId: creatorId as string | null, setChannel: vi.fn(async (destination: string | { id: string }) => {
    if (overrides.moveFails) throw new Error('Move failed');
    const id = typeof destination === 'string' ? destination : destination.id;
    member.voice.channelId = id;
    if (id === roomId) members.set(userId, member);
  }) } };
  const repository = {
    getSettings: vi.fn(async () => settings), listCreators: vi.fn(async () => [configuredCreator]), disableCreator: vi.fn(async () => undefined),
    watchCreators: vi.fn((_id: string, onChange: (value: typeof creator[]) => void) => { onChange([configuredCreator]); return () => undefined; }),
    listRooms: vi.fn(async () => [...rooms.values()]), getCreator: vi.fn(async () => configuredCreator),
    saveRoom: vi.fn(async (room: VoiceRoom) => { rooms.set(room.channelId, room); }),
    updateRoom: vi.fn(async (_guildId: string, id: string, patch: Partial<VoiceRoom>) => { const room = rooms.get(id); if (room) rooms.set(id, { ...room, ...patch }); }),
    deleteRoom: vi.fn(async (_guildId: string, id: string) => { rooms.delete(id); }), audit: vi.fn(async () => undefined),
    changeOwner: vi.fn(async (_guildId: string, id: string, expected: string | null, next: string | null) => {
      const room = rooms.get(id);
      if (!room || room.ownerId !== expected) return false;
      rooms.set(id, { ...room, ownerId: next }); return true;
    }),
  };
  const service = new VoiceService({ guilds: { cache: new Map() } } as unknown as Client, repository as unknown as VoiceRepository, { accessMappings: vi.fn(async () => ({ roles: [], members: [] })) } as unknown as GuildRepository);
  const state = (channelId: string | null) => ({ guild, member, id: userId, channelId }) as unknown as VoiceState;
  return { service, repository, guild, member, rooms, create, setPosition, deleteChannel, state, members, channel };
}

describe('creator joins', () => {
  it('creates, persists and moves the owner', async () => {
    const h = harness(); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.member.voice.setChannel).toHaveBeenCalledWith(expect.objectContaining({ id: roomId }));
    expect(h.rooms.get(roomId)).toMatchObject({ ownerId: userId, state: 'active', memberCount: 1 });
    h.service.stop();
  });
  it('does not treat a room as a Creator when an old configuration points to it', async () => {
    const h = harness(); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    const onCreatorsChanged = h.repository.watchCreators.mock.calls[0]?.[1];
    onCreatorsChanged?.([{ ...creator, id: roomId, channelId: roomId }]);
    h.create.mockClear();
    await h.service.onVoiceState(h.state(null), h.state(roomId));
    expect(h.create).not.toHaveBeenCalled();
    h.service.stop();
  });
  it('places a room above the Creator when configured', async () => {
    const h = harness({ roomPlacement: 'above' }); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    expect(h.setPosition).toHaveBeenCalledWith(0, { reason: 'SCRT temporary room placement' });
    expect(h.rooms.get(roomId)?.state).toBe('active');
    h.service.stop();
  });
  it('removes an empty room if Discord rejects its position', async () => {
    const h = harness({ roomPlacement: 'above', positionFails: true }); await h.service.recover(h.guild);
    await expect(h.service.onVoiceState(h.state(null), h.state(creatorId))).rejects.toThrow('розмістити');
    expect(h.deleteChannel).toHaveBeenCalledOnce();
    expect(h.rooms.size).toBe(0);
    h.service.stop();
  });
  it('ignores bots and disabled settings', async () => {
    for (const options of [{ bot: true }, { enabled: false }]) {
      const h = harness(options); await h.service.recover(h.guild);
      await h.service.onVoiceState(h.state(null), h.state(creatorId));
      expect(h.create).not.toHaveBeenCalled(); h.service.stop();
    }
  });
  it('reuses an existing room instead of creating another', async () => {
    const h = harness(); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    h.member.voice.channelId = creatorId;
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.member.voice.setChannel).toHaveBeenLastCalledWith(roomId);
    h.service.stop();
  });
  it('deletes an empty channel and record when moving fails', async () => {
    const h = harness({ moveFails: true }); await h.service.recover(h.guild);
    await expect(h.service.onVoiceState(h.state(null), h.state(creatorId))).rejects.toThrow('Move failed');
    expect(h.deleteChannel).toHaveBeenCalledOnce();
    expect(h.rooms.size).toBe(0);
    h.service.stop();
  });
  it('retains a failed creation for recovery when Discord rejects rollback deletion', async () => {
    const h = harness({ moveFails: true }); await h.service.recover(h.guild);
    h.deleteChannel.mockRejectedValueOnce(new Error('Discord unavailable'));
    try {
      await expect(h.service.onVoiceState(h.state(null), h.state(creatorId))).rejects.toThrow('Move failed');
      expect(h.rooms.get(roomId)?.state).toBe('creating');
      expect(h.repository.deleteRoom).not.toHaveBeenCalled();
    } finally { h.service.stop(); }
  });
  it.each(['retry', 'occupied', 'stopped'] as const)('handles cleanup failure when the room becomes %s', async (outcome) => {
    vi.useFakeTimers();
    const h = harness();
    try {
      await h.service.recover(h.guild);
      await h.service.onVoiceState(h.state(null), h.state(creatorId));
      h.members.clear(); h.member.voice.channelId = null;
      h.deleteChannel.mockRejectedValueOnce(new Error('Discord unavailable'));
      await h.service.onVoiceState(h.state(roomId), h.state(null));
      await vi.advanceTimersByTimeAsync(1);
      expect(h.deleteChannel).toHaveBeenCalledOnce();
      expect(h.rooms.has(roomId)).toBe(true);
      if (outcome === 'occupied') {
        h.members.set(userId, h.member); h.member.voice.channelId = roomId;
        await h.service.onVoiceState(h.state(null), h.state(roomId));
      }
      if (outcome === 'stopped') h.service.stop();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.deleteChannel).toHaveBeenCalledTimes(outcome === 'retry' ? 2 : 1);
      expect(h.rooms.has(roomId)).toBe(outcome !== 'retry');
    } finally { h.service.stop(); vi.useRealTimers(); }
  });
  it('enforces the room limit when duplicate rooms are allowed', async () => {
    const h = harness({ duplicateRoomPolicy: 'allow', maxRoomsPerUser: 1 }); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    h.member.voice.channelId = creatorId;
    await expect(h.service.onVoiceState(h.state(null), h.state(creatorId))).rejects.toThrow('ліміту');
    expect(h.create).toHaveBeenCalledOnce(); h.service.stop();
  });
  it('lets the owner lock and rejects an unrelated member', async () => {
    const h = harness(); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    expect(await h.service.act({ member: h.member as unknown as GuildMember, action: 'lock' })).toBe('Кімнату закрито.');
    expect(h.rooms.get(roomId)?.locked).toBe(true);
    const stranger = { ...h.member, id: '92345678901234567', voice: { ...h.member.voice, channelId: roomId } };
    await expect(h.service.act({ member: stranger as unknown as GuildMember, action: 'unlock' })).rejects.toThrow('власником');
    h.service.stop();
  });
  it('keeps room controls and fresh occupancy when a join overlaps a pending save', async () => {
    const h = harness(); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.repository.saveRoom.mockImplementationOnce(async (room) => { await gate; h.rooms.set(room.channelId, room); });
    h.repository.saveRoom.mockClear();
    const locking = h.service.act({ member: h.member as unknown as GuildMember, action: 'lock' });
    await vi.waitFor(() => expect(h.repository.saveRoom).toHaveBeenCalledOnce());
    h.members.set('72345678901234567', { id: '72345678901234567', user: { bot: false } });
    const joining = h.service.onVoiceState(h.state(null), h.state(roomId));
    release(); await Promise.all([locking, joining]);
    expect(h.rooms.get(roomId)).toMatchObject({ locked: true, memberCount: 2 });
    h.service.stop();
  });
  it('does not recreate a deleted room when a control save completes afterwards', async () => {
    const h = harness(); await h.service.recover(h.guild);
    await h.service.onVoiceState(h.state(null), h.state(creatorId));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.repository.saveRoom.mockImplementationOnce(async (room) => { await gate; h.rooms.set(room.channelId, room); });
    h.repository.saveRoom.mockClear();
    const locking = h.service.act({ member: h.member as unknown as GuildMember, action: 'lock' });
    await vi.waitFor(() => expect(h.repository.saveRoom).toHaveBeenCalledOnce());
    h.guild.channels.cache.delete(roomId);
    const deletion = h.service.onChannelDelete(h.guild, roomId);
    release(); await Promise.all([locking, deletion]);
    expect(h.rooms.has(roomId)).toBe(false);
    expect(h.service.roomForMember(h.member as unknown as GuildMember)).toBeNull();
    h.service.stop();
  });
  it('deletes an empty room after the configured delay', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); await h.service.recover(h.guild);
      await h.service.onVoiceState(h.state(null), h.state(creatorId));
      h.members.clear(); h.member.voice.channelId = null;
      await h.service.onVoiceState(h.state(roomId), h.state(null));
      await vi.runAllTimersAsync();
      expect(h.deleteChannel).toHaveBeenCalledOnce();
      expect(h.rooms.size).toBe(0);
      h.service.stop();
    } finally { vi.useRealTimers(); }
  });
});

describe('startup recovery', () => {
  const savedRoom = () => voiceRoomSchema.parse({ guildId, channelId: roomId, creatorId, ownerId: userId, state: 'active', locked: false, hidden: false, chatClosed: false, permittedUserIds: [], blockedUserIds: [], memberCount: 1, ownerLeftAt: null, createdAt: Date.now(), updatedAt: Date.now(), lastActivityAt: Date.now(), schemaVersion: 1 });
  it.each(['ownership', 'permissions'] as const)('retries owner exit after a transient %s failure', async (stage) => {
    vi.useFakeTimers();
    const h = harness({ ownerLeaveGraceSeconds: 0 });
    try {
      h.rooms.set(roomId, { ...savedRoom(), locked: true });
      h.members.set('72345678901234567', { id: '72345678901234567', user: { bot: false } });
      await h.service.recover(h.guild);
      h.channel.permissionOverwrites.set.mockClear();
      if (stage === 'ownership') h.repository.changeOwner.mockRejectedValueOnce(new Error('Database unavailable'));
      else h.channel.permissionOverwrites.set.mockRejectedValueOnce(new Error('Discord unavailable'));
      await vi.advanceTimersByTimeAsync(1);
      expect(h.rooms.get(roomId)?.ownerId).toBe(stage === 'ownership' ? userId : null);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.rooms.get(roomId)?.ownerId).toBeNull();
      expect(h.channel.permissionOverwrites.set).toHaveBeenCalledTimes(stage === 'ownership' ? 1 : 2);
    } finally { h.service.stop(); vi.useRealTimers(); }
  });

  it('shares concurrent recovery and reuses loaded creator configuration', async () => {
    const h = harness(); h.rooms.set(roomId, savedRoom()); h.members.set(userId, h.member);
    await Promise.all([h.service.recover(h.guild), h.service.recover(h.guild)]);
    expect(h.repository.listRooms).toHaveBeenCalledOnce();
    expect(h.repository.watchCreators).toHaveBeenCalledOnce();
    expect(h.repository.getCreator).not.toHaveBeenCalled();
    h.service.stop();
  });
  it('does not install subscriptions or restore rooms after a pending recovery is stopped', async () => {
    const h = harness(); h.rooms.set(roomId, savedRoom());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.repository.listRooms.mockImplementationOnce(async () => { await gate; return [...h.rooms.values()]; });
    const recovery = h.service.recover(h.guild);
    await vi.waitFor(() => expect(h.repository.listRooms).toHaveBeenCalledOnce());
    h.service.stopGuild(guildId); release(); await recovery;
    expect(h.repository.watchCreators).not.toHaveBeenCalled();
    expect(h.service.roomForMember({ ...h.member, voice: { channelId: roomId } } as unknown as GuildMember)).toBeNull();
    h.service.stop();
  });
  it('removes a record whose Discord channel disappeared', async () => {
    const h = harness(); h.rooms.set(roomId, savedRoom()); h.guild.channels.cache.delete(roomId);
    await h.service.recover(h.guild);
    expect(h.rooms.size).toBe(0);
    h.service.stop();
  });
  it('keeps a populated room and ownership', async () => {
    const h = harness(); h.rooms.set(roomId, savedRoom()); h.members.set(userId, h.member);
    await h.service.recover(h.guild);
    expect(h.service.roomForMember({ ...h.member, voice: { ...h.member.voice, channelId: roomId } } as unknown as GuildMember)?.ownerId).toBe(userId);
    expect(h.deleteChannel).not.toHaveBeenCalled();
    h.service.stop();
  });
  it('resumes cleanup for an empty room', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); h.rooms.set(roomId, savedRoom());
      await h.service.recover(h.guild); await vi.runAllTimersAsync();
      expect(h.deleteChannel).toHaveBeenCalledOnce(); expect(h.rooms.size).toBe(0);
      h.service.stop();
    } finally { vi.useRealTimers(); }
  });
  it('releases an absent owner and allows exactly one claimant', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ cleanupDelaySeconds: 60, ownerLeaveGraceSeconds: 0 });
      h.rooms.set(roomId, { ...savedRoom(), ownerLeftAt: Date.now() - 1000 });
      const first = { ...h.member, id: '72345678901234567', voice: { ...h.member.voice, channelId: roomId } };
      const second = { ...h.member, id: '82345678901234567', voice: { ...h.member.voice, channelId: roomId } };
      h.members.set(first.id, first); h.members.set(second.id, second);
      await h.service.recover(h.guild); await vi.runAllTimersAsync();
      expect(h.rooms.get(roomId)?.ownerId).toBeNull();
      const results = await Promise.allSettled([h.service.act({ member: first as unknown as GuildMember, action: 'claim' }), h.service.act({ member: second as unknown as GuildMember, action: 'claim' })]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(h.rooms.get(roomId)?.ownerId).toBe(first.id);
      h.service.stop();
    } finally { vi.useRealTimers(); }
  });
  it('cancels the owner grace timer when the owner returns', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ cleanupDelaySeconds: 60, ownerLeaveGraceSeconds: 60 });
      h.rooms.set(roomId, { ...savedRoom(), ownerLeftAt: Date.now() });
      h.members.set('72345678901234567', { id: '72345678901234567', user: { bot: false } });
      await h.service.recover(h.guild);
      h.members.set(userId, h.member); h.member.voice.channelId = roomId;
      await h.service.onVoiceState(h.state(null), h.state(roomId));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.rooms.get(roomId)?.ownerId).toBe(userId);
      expect(h.rooms.get(roomId)?.ownerLeftAt).toBeNull();
      h.service.stop();
    } finally { vi.useRealTimers(); }
  });
});
