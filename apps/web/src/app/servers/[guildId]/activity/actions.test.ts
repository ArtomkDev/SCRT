import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activitySettingsSchema } from '@scrt/validation';
const mocks = vi.hoisted(() => ({ access: vi.fn(), channels: vi.fn(), roles: vi.fn(), member: vi.fn(), get: vi.fn(), save: vi.fn(), ignored: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/server', () => ({ env: () => ({ DISCORD_BOT_TOKEN: 'test' }), activity: () => ({ getSettings: mocks.get, saveSettings: mocks.save, setGameIgnored: mocks.ignored }) }));
vi.mock('@scrt/discord', () => ({ botGuildChannels: mocks.channels, botGuildRoles: mocks.roles, botGuildMember: mocks.member }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { enableActivity, saveActivitySettings, setActivityGameIgnored } from './actions';
const guildId = '12345678901234567';
function form() {
  const data = new FormData();
  for (const key of ['enabled', 'messages', 'voice', 'streaming', 'games', 'voiceStreaks', 'ignoreAfkChannel']) data.set(key, 'on');
  data.set('timezone', 'Europe/Kyiv');
  for (const key of ['voiceMinimum', 'streamMinimum', 'gameMinimum']) data.set(key, '60');
  data.set('streakMinimum', '300');
  return data;
}
describe('Activity backend configuration security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ user: { id: '22345678901234567' } });
    mocks.channels.mockResolvedValue([{ id: '32345678901234567', type: 2 }]);
    mocks.roles.mockResolvedValue([{ id: '42345678901234567' }]);
    mocks.get.mockResolvedValue(activitySettingsSchema.parse({}));
    mocks.save.mockResolvedValue(undefined);
  });
  it('requires manage before any Discord/Firestore reads or writes', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(saveActivitySettings(guildId, form())).rejects.toThrow('Forbidden');
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.manage');
    expect(mocks.channels).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('enables only the current guild and preserves configuration and historical exclusions', async () => {
    const settings = activitySettingsSchema.parse({ enabled: false, games: { ignoredGameKeys: ['name:dota 2'] } });
    mocks.get.mockResolvedValue(settings);
    await enableActivity(guildId);
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.manage');
    expect(mocks.save).toHaveBeenCalledWith(guildId, { ...settings, enabled: true }, '22345678901234567');
    expect(mocks.revalidate).toHaveBeenCalledWith(`/servers/${guildId}`, 'layout');
    expect(mocks.channels).not.toHaveBeenCalled();
  });
  it('denies enabling before settings reads when manage permission is missing', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(enableActivity(guildId)).rejects.toThrow('Forbidden');
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['channelIds', 'categoryIds', 'roleIds'])('rejects cross-guild %s', async (field) => {
    const data = form(); data.append(field, '52345678901234567');
    await expect(saveActivitySettings(guildId, data)).rejects.toThrow('цьому серверу');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('checks new user exclusions through guild-scoped REST', async () => {
    const data = form(); data.append('userIds', '52345678901234567');
    mocks.member.mockRejectedValue(new Error('Member not in guild'));
    await expect(saveActivitySettings(guildId, data)).rejects.toThrow('Member not in guild');
    expect(mocks.member).toHaveBeenCalledWith('test', guildId, '52345678901234567');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('validates timezone before resource calls and derives actor from the session', async () => {
    const invalid = form(); invalid.set('timezone', 'Mars');
    await expect(saveActivitySettings(guildId, invalid)).rejects.toThrow('часовий пояс');
    expect(mocks.channels).not.toHaveBeenCalled();
    const data = form(); data.set('actorId', '99999999999999999');
    await saveActivitySettings(guildId, data);
    expect(mocks.save).toHaveBeenCalledWith(guildId, expect.objectContaining({ enabled: true }), '22345678901234567');
  });
});

describe('Observed activity policy authorization', () => {
  it('requires manage before writing exclusions', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    const data = new FormData(); data.set('gameKey', 'name:dota 2'); data.set('mode', 'ignore');
    await expect(setActivityGameIgnored(guildId, data)).rejects.toThrow('Forbidden');
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'activity.manage');
    expect(mocks.ignored).not.toHaveBeenCalled();
  });
  it('validates key and mode and uses the session actor', async () => {
    mocks.access.mockResolvedValue({ user: { id: '22345678901234567' } });
    const data = new FormData(); data.set('gameKey', '../other'); data.set('mode', 'ignore');
    await expect(setActivityGameIgnored(guildId, data)).rejects.toThrow();
    data.set('gameKey', 'name:dota 2'); data.set('mode', 'delete');
    await expect(setActivityGameIgnored(guildId, data)).rejects.toThrow('Невідома');
    data.set('mode', 'ignore'); data.set('actorId', '99999999999999999');
    await setActivityGameIgnored(guildId, data);
    expect(mocks.ignored).toHaveBeenCalledWith(guildId, 'name:dota 2', true, '22345678901234567');
    data.set('mode', 'track'); await setActivityGameIgnored(guildId, data);
    expect(mocks.ignored).toHaveBeenLastCalledWith(guildId, 'name:dota 2', false, '22345678901234567');
  });
});
