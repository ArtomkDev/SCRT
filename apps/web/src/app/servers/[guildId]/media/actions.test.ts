import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaSettingsSchema } from '@scrt/validation';

const mocks = vi.hoisted(() => ({ access: vi.fn(), settings: vi.fn(), resources: vi.fn(), internal: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/server', () => ({ media: () => ({ getSettings: mocks.settings }) }));
vi.mock('@/lib/voice-data', () => ({ voiceResources: mocks.resources }));
vi.mock('@/lib/media-data', async (original) => ({ ...await original<typeof import('@/lib/media-data')>(), mediaInternal: mocks.internal }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('server-only', () => ({}));
import { MediaTransportError } from '@/lib/media-data';
import { saveMediaSettings } from './actions';

const guildId = '12345678901234567';
const userId = '22345678901234567';
function form() {
  const data = new FormData();
  const settings = mediaSettingsSchema.parse({ enabled: true });
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'boolean') { if (value) data.set(key, 'on'); }
    else if (typeof value === 'number' || typeof value === 'string') data.set(key, String(value));
  }
  for (const [key, value] of Object.entries(settings.sameVoiceUsersCan)) if (value) data.set(`policy.${key}`, 'on');
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ user: { id: userId }, guild: { resourceRevision: 5 } });
  mocks.settings.mockResolvedValue(mediaSettingsSchema.parse({}));
  mocks.resources.mockResolvedValue({ roles: [], channels: [] });
  mocks.internal.mockResolvedValue(mediaSettingsSchema.parse({ enabled: true }));
});

describe('Media settings save', () => {
  it('enables the authorized guild with default form values and the session actor', async () => {
    const data = form(); data.set('actorUserId', '99999999999999999');
    await expect(saveMediaSettings(guildId, data)).resolves.toBeUndefined();
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'media.manage');
    expect(mocks.internal).toHaveBeenCalledWith({ operation: 'settings', guildId, actorUserId: userId, settings: mediaSettingsSchema.parse({ enabled: true }) });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/servers/${guildId}`, 'layout');
  });

  it('returns the safe API failure without revalidating or claiming a successful save', async () => {
    mocks.internal.mockRejectedValue(new MediaTransportError('Запустіть або перезапустіть бота.', 503));
    await expect(saveMediaSettings(guildId, form())).resolves.toEqual({ error: 'Запустіть або перезапустіть бота.' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('keeps unexpected internal errors out of the returned feedback', async () => {
    mocks.internal.mockRejectedValue(new Error('Private infrastructure details'));
    await expect(saveMediaSettings(guildId, form())).rejects.toThrow('Private infrastructure details');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('requires manage permission before reading settings or contacting the bot', async () => {
    mocks.access.mockRejectedValue(new Error('Forbidden'));
    await expect(saveMediaSettings(guildId, form())).rejects.toThrow('Forbidden');
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.internal).not.toHaveBeenCalled();
  });

  it.each(['djRoleIds', 'allowedVoiceChannelIds', 'blockedVoiceChannelIds', 'allowedCategoryIds'])('rejects foreign %s before contacting the bot', async (key) => {
    const data = form(); data.append(key, '32345678901234567');
    await expect(saveMediaSettings(guildId, data)).resolves.toEqual({ error: 'Виберіть чинні ресурси цього сервера.' });
    expect(mocks.internal).not.toHaveBeenCalled();
  });

  it('returns validation feedback before resource calls when volume exceeds the limit', async () => {
    const data = form(); data.set('maxVolume', '10');
    expect(await saveMediaSettings(guildId, data)).toEqual({ error: expect.stringContaining('гучність') });
    expect(mocks.resources).not.toHaveBeenCalled();
    expect(mocks.internal).not.toHaveBeenCalled();
  });
});
