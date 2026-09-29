import { describe, expect, it } from 'vitest';
import { OverwriteType, PermissionFlagsBits, PermissionsBitField, type Guild, type VoiceChannel } from 'discord.js';
import { voiceCreatorSchema, voiceRoomSchema, voiceSettingsSchema } from '@scrt/validation';
import { roomOverwrites } from './room-permissions';

const guildId = '12345678901234567';
const creatorId = '22345678901234567';
const roomId = '32345678901234567';
const ownerId = '42345678901234567';
const blockedId = '52345678901234567';
const permittedId = '62345678901234567';
const roleId = '72345678901234567';
const creator = voiceCreatorSchema.parse({ id: creatorId, guildId, channelId: creatorId });
const settings = voiceSettingsSchema.parse({});
const room = voiceRoomSchema.parse({ channelId: roomId, guildId, creatorId, ownerId, state: 'active', locked: true, hidden: true, chatClosed: true, permittedUserIds: [permittedId], blockedUserIds: [blockedId], memberCount: 1, ownerLeftAt: null, createdAt: 1, updatedAt: 1, lastActivityAt: 1, schemaVersion: 1 });
const baseline = new Map([[roleId, { id: roleId, type: OverwriteType.Role, allow: new PermissionsBitField(PermissionFlagsBits.Connect | PermissionFlagsBits.SendMessages), deny: new PermissionsBitField(PermissionFlagsBits.UseApplicationCommands) }]]);
const guild = { id: guildId, members: { me: { id: '82345678901234567' } }, channels: { cache: new Map() } } as unknown as Guild;
const channel = { parent: { permissionOverwrites: { cache: baseline } }, permissionOverwrites: { cache: new Map() } } as unknown as VoiceChannel;

describe('room permission reconciliation', () => {
  it('keeps category permissions while blocking ordinary users', () => {
    const rows = roomOverwrites(guild, channel, creator, settings, room);
    const role = rows.find((row) => row.id === roleId)!;
    const blocked = rows.find((row) => row.id === blockedId)!;
    const permitted = rows.find((row) => row.id === permittedId)!;
    const owner = rows.find((row) => row.id === ownerId)!;
    expect(new PermissionsBitField(role.deny).has(PermissionFlagsBits.UseApplicationCommands)).toBe(true);
    expect(new PermissionsBitField(role.deny).has(PermissionFlagsBits.Connect)).toBe(true);
    expect(new PermissionsBitField(blocked.deny).has(PermissionFlagsBits.ViewChannel)).toBe(true);
    expect(new PermissionsBitField(permitted.allow).has(PermissionFlagsBits.Connect)).toBe(true);
    expect(new PermissionsBitField(owner.allow).has(PermissionFlagsBits.ViewChannel)).toBe(true);
    const bot = rows.find((row) => row.id === guild.members.me!.id)!;
    expect(new PermissionsBitField(bot.allow).has(PermissionFlagsBits.Connect)).toBe(true);
    expect(new PermissionsBitField(bot.allow).has(PermissionFlagsBits.ManageRoles)).toBe(false);
  });
  it('restores category access on unlock while retaining blocks', () => {
    const rows = roomOverwrites(guild, channel, creator, settings, { ...room, locked: false, hidden: false, chatClosed: false });
    const role = rows.find((row) => row.id === roleId)!;
    const blocked = rows.find((row) => row.id === blockedId)!;
    expect(new PermissionsBitField(role.allow).has(PermissionFlagsBits.Connect)).toBe(true);
    expect(new PermissionsBitField(blocked.deny).has(PermissionFlagsBits.Connect)).toBe(true);
  });
  it('does not write redundant overwrites for an unrestricted room', () => {
    const ordinaryRoom = { ...room, locked: false, hidden: false, chatClosed: false, permittedUserIds: [], blockedUserIds: [] };
    const plainChannel = { parent: null, permissionOverwrites: { cache: new Map() } } as unknown as VoiceChannel;
    expect(roomOverwrites(guild, plainChannel, creator, settings, ordinaryRoom)).toEqual([]);
  });
  it('does not add an overwrite for the server owner', () => {
    const ownerGuild = { ...guild, ownerId } as Guild;
    const rows = roomOverwrites(ownerGuild, channel, creator, settings, room);
    expect(rows.some((row) => row.id === ownerId)).toBe(false);
  });
});
