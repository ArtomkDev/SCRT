import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireGuildAccess: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn(), saveCreator: vi.fn(), getCreator: vi.fn(), getRoom: vi.fn(), deleteCreator: vi.fn(), audit: vi.fn(),
  channels: vi.fn(), roles: vi.fn(), regions: vi.fn(), createChannel: vi.fn(), renameChannel: vi.fn(), deleteChannel: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn(),
}));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('@/lib/server', () => ({ env: () => ({ DISCORD_BOT_TOKEN: 'test' }), voice: () => ({ getSettings: mocks.getSettings, saveSettings: mocks.saveSettings, saveCreator: mocks.saveCreator, getCreator: mocks.getCreator, getRoom: mocks.getRoom, deleteCreator: mocks.deleteCreator, audit: mocks.audit }) }));
vi.mock('@scrt/discord', () => ({ botGuildChannels: mocks.channels, botGuildRoles: mocks.roles, botVoiceRegions: mocks.regions, botCreateVoiceChannel: mocks.createChannel, botRenameVoiceChannel: mocks.renameChannel, botDeleteChannel: mocks.deleteChannel }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));

import { deleteVoiceCreator, enableVoice, saveVoiceCreator, saveVoiceSettings } from './actions';
import { defaultCreatorChannelName, voiceSettingsSchema } from '@scrt/validation';

const guildId = '12345678901234567';
function form(roleId?: string) {
  const data = new FormData();
  data.set('cleanupDelaySeconds', '30'); data.set('ownerLeaveGraceSeconds', '60'); data.set('ownerExitBehavior', 'claimable');
  data.set('duplicateRoomPolicy', 'reuse'); data.set('maxRoomsPerUser', '1'); data.set('defaultInterfaceMode', 'room');
  if (roleId) data.append('bypassRoleIds', roleId);
  return data;
}
describe('Voice dashboard mutations', () => {
  it('enables Voice only after manage authorization and preserves existing settings', async () => {
    const settings = voiceSettingsSchema.parse({ enabled: false, cleanupDelaySeconds: 60 });
    mocks.getSettings.mockResolvedValue(settings);
    await enableVoice(guildId);
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(guildId, 'voice.manage');
    expect(mocks.saveSettings).toHaveBeenCalledWith(guildId, { ...settings, enabled: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/servers/${guildId}`, 'layout');
  });
  it('denies enabling before reading settings when manage permission is missing', async () => {
    mocks.requireGuildAccess.mockRejectedValue(new Error('Forbidden'));
    await expect(enableVoice(guildId)).rejects.toThrow('Forbidden');
    expect(mocks.getSettings).not.toHaveBeenCalled(); expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireGuildAccess.mockResolvedValue({ permissions: new Set(['voice.manage']) });
    mocks.channels.mockResolvedValue([]);
    mocks.roles.mockResolvedValue([{ id: guildId, name: '@everyone', permissions: '0' }]);
    mocks.saveSettings.mockResolvedValue(undefined);
    mocks.saveCreator.mockResolvedValue(undefined);
    mocks.getCreator.mockResolvedValue(null);
    mocks.getRoom.mockResolvedValue(null);
    mocks.deleteCreator.mockResolvedValue(undefined);
    mocks.createChannel.mockResolvedValue({ id: '22345678901234567' });
    mocks.renameChannel.mockResolvedValue({ id: '22345678901234567', name: 'Новий Creator', type: 2 });
    mocks.audit.mockResolvedValue(undefined);
  });
  it('checks voice.manage before reading or writing guild data', async () => {
    mocks.requireGuildAccess.mockRejectedValue(new Error('Forbidden'));
    await expect(saveVoiceSettings(guildId, form())).rejects.toThrow('Forbidden');
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(guildId, 'voice.manage');
    expect(mocks.channels).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
  it('rejects a role ID that is not in the authorized guild', async () => {
    await expect(saveVoiceSettings(guildId, form('22345678901234567'))).rejects.toThrow('Invalid bypass role');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
  it('saves settings without refetching or invalidating unchanged Discord resources', async () => {
    await saveVoiceSettings(guildId, form());
    expect(mocks.saveSettings).toHaveBeenCalledOnce();
    expect(mocks.channels).not.toHaveBeenCalled();
    expect(mocks.roles).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/servers/${guildId}`, 'layout');
  });
  it('does not report a completed settings write as failed when auditing fails', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(saveVoiceSettings(guildId, form())).resolves.toBeUndefined();
      expect(mocks.saveSettings).toHaveBeenCalledOnce();
      expect(mocks.revalidatePath).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it('uses the visible default when creating a channel with an empty name', async () => {
    const data = new FormData();
    data.set('channelId', 'new');
    data.set('nameTemplate', '🎧 {displayName}');
    data.set('defaultUserLimit', '0');
    data.set('interfaceMode', 'inherit');
    await saveVoiceCreator(guildId, data);
    expect(mocks.createChannel).toHaveBeenCalledWith('test', guildId, defaultCreatorChannelName, null);
    expect(mocks.saveCreator).toHaveBeenCalledOnce();
  });
  it('saves the selected room position and order', async () => {
    const data = new FormData();
    data.set('channelId', 'new');
    data.set('nameTemplate', '🎧 {displayName}');
    data.set('defaultUserLimit', '0');
    data.set('interfaceMode', 'inherit');
    data.set('roomPlacement', 'above');
    data.set('roomOrder', 'newest_first');
    await saveVoiceCreator(guildId, data);
    expect(mocks.saveCreator).toHaveBeenCalledWith(guildId, expect.objectContaining({ roomPlacement: 'above', roomOrder: 'newest_first' }));
  });
  it('rejects a temporary room even if its channel ID is submitted directly', async () => {
    const roomId = '32345678901234567';
    mocks.channels.mockResolvedValue([{ id: roomId, type: 2 }]);
    mocks.getRoom.mockResolvedValue({ guildId, channelId: roomId });
    const data = new FormData();
    data.set('channelId', roomId);
    data.set('nameTemplate', '🎧 {displayName}');
    data.set('defaultUserLimit', '0');
    data.set('interfaceMode', 'inherit');
    await expect(saveVoiceCreator(guildId, data)).rejects.toThrow('Тимчасову кімнату');
    expect(mocks.getRoom).toHaveBeenCalledWith(guildId, roomId);
    expect(mocks.saveCreator).not.toHaveBeenCalled();
  });
  it('renames an existing Creator channel and invalidates the channel list', async () => {
    const channelId = '22345678901234567';
    mocks.channels.mockResolvedValue([{ id: channelId, type: 2, name: 'Стара назва' }]);
    mocks.getCreator.mockResolvedValue({ id: channelId, channelId });
    const data = new FormData();
    data.set('channelId', channelId);
    data.set('renameCreatorChannel', 'on');
    data.set('originalCreatorChannelName', 'Стара назва');
    data.set('creatorChannelName', 'Нова назва');
    data.set('nameTemplate', '🎧 {displayName}');
    data.set('defaultUserLimit', '0');
    data.set('interfaceMode', 'inherit');
    await saveVoiceCreator(guildId, data);
    expect(mocks.renameChannel).toHaveBeenCalledWith('test', channelId, 'Нова назва');
    expect(mocks.saveCreator).toHaveBeenCalledOnce();
    expect(mocks.updateTag).toHaveBeenCalledWith(`voice-channels:${guildId}`);
  });
  it('does not rename an unchanged channel or a newly selected existing channel', async () => {
    const channelId = '22345678901234567';
    mocks.channels.mockResolvedValue([{ id: channelId, type: 2, name: 'Creator' }]);
    const data = new FormData();
    data.set('channelId', channelId);
    data.set('creatorChannelName', 'Creator');
    data.set('originalCreatorChannelName', 'Creator');
    data.set('renameCreatorChannel', 'on');
    data.set('nameTemplate', '🎧 {displayName}');
    data.set('defaultUserLimit', '0');
    data.set('interfaceMode', 'inherit');
    mocks.getCreator.mockResolvedValue({ id: channelId, channelId });
    await saveVoiceCreator(guildId, data);
    data.delete('renameCreatorChannel');
    data.set('creatorChannelName', defaultCreatorChannelName);
    mocks.getCreator.mockResolvedValue(null);
    await saveVoiceCreator(guildId, data);
    expect(mocks.renameChannel).not.toHaveBeenCalled();
  });
  it('restores the old name if saving Creator settings fails after a rename', async () => {
    const channelId = '22345678901234567';
    mocks.channels.mockResolvedValue([{ id: channelId, type: 2, name: 'Стара назва' }]);
    mocks.getCreator.mockResolvedValue({ id: channelId, channelId });
    mocks.saveCreator.mockRejectedValue(new Error('Database unavailable'));
    const data = new FormData();
    data.set('channelId', channelId);
    data.set('renameCreatorChannel', 'on');
    data.set('originalCreatorChannelName', 'Стара назва');
    data.set('creatorChannelName', 'Нова назва');
    data.set('nameTemplate', '🎧 {displayName}');
    data.set('defaultUserLimit', '0');
    data.set('interfaceMode', 'inherit');
    await expect(saveVoiceCreator(guildId, data)).rejects.toThrow('Database unavailable');
    expect(mocks.renameChannel).toHaveBeenNthCalledWith(1, 'test', channelId, 'Нова назва');
    expect(mocks.renameChannel).toHaveBeenNthCalledWith(2, 'test', channelId, 'Стара назва');
  });
  it('deletes only SCRT settings unless channel removal is explicitly requested', async () => {
    mocks.getCreator.mockResolvedValue({ id: '22345678901234567', channelId: '22345678901234567' });
    const data = new FormData();
    data.set('creatorId', '22345678901234567');
    await deleteVoiceCreator(guildId, data);
    expect(mocks.deleteCreator).toHaveBeenCalledWith(guildId, '22345678901234567');
    expect(mocks.deleteChannel).not.toHaveBeenCalled();
  });
  it('requires the channel deletion intent before removing a Discord channel', async () => {
    mocks.getCreator.mockResolvedValue({ id: '22345678901234567', channelId: '22345678901234567' });
    const data = new FormData();
    data.set('creatorId', '22345678901234567');
    data.set('alsoDeleteChannel', 'on');
    await expect(deleteVoiceCreator(guildId, data)).rejects.toThrow('Confirm Discord channel deletion');
    expect(mocks.deleteChannel).not.toHaveBeenCalled();
    data.set('confirmDelete', 'confirmed');
    mocks.channels.mockResolvedValue([{ id: '22345678901234567', type: 2 }]);
    await deleteVoiceCreator(guildId, data);
    expect(mocks.deleteChannel).toHaveBeenCalledWith('test', '22345678901234567');
  });
});
