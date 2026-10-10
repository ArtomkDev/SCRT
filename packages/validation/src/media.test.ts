import { describe, expect, it } from 'vitest';
import { mediaRequestSchema, mediaSettingsSchema, mediaActionSchema } from './media';
describe('Media validation', () => {
  it('defaults legacy settings to five minutes and validates inactivity disconnect', () => {
    expect(mediaSettingsSchema.parse({}).inactivityDisconnectSeconds).toBe(300);
    for (const value of [0, 1, 300, 3600]) expect(mediaSettingsSchema.safeParse({ inactivityDisconnectSeconds: value }).success).toBe(true);
    for (const value of [-1, 0.5, 3601, Infinity, '300']) expect(mediaSettingsSchema.safeParse({ inactivityDisconnectSeconds: value }).success).toBe(false);
  });
  it('accepts bounded seeks tied to a queue identity and rejects untrusted fields', () => {
    const action = { type: 'SEEK', queueItemId: 'f5d12265-0d78-48f2-a1c6-ec72ef5c8eae', positionMs: 30000 };
    expect(mediaActionSchema.safeParse(action).success).toBe(true);
    expect(mediaActionSchema.safeParse({ ...action, positionMs: 0 }).success).toBe(true);
    for (const positionMs of [-1, 1.5, NaN, Infinity, 10800001]) expect(mediaActionSchema.safeParse({ ...action, positionMs }).success).toBe(false);
    expect(mediaActionSchema.safeParse({ ...action, queueItemId: 'unknown' }).success).toBe(false);
    expect(mediaActionSchema.safeParse({ ...action, actorUserId: '12345678901234567' }).success).toBe(false);
  });
  it('accepts only bounded canonical references for search continuation', () => {
    const action = { type: 'PLAY_TRACK', provider: 'youtube', providerItemId: 'hmzIgMhbefo', following: [{ provider: 'soundcloud', providerItemId: 'https://soundcloud.com/artist/song' }] };
    expect(mediaActionSchema.safeParse(action).success).toBe(true);
    expect(mediaActionSchema.safeParse({ ...action, following: Array(100).fill(action.following[0]) }).success).toBe(false);
    expect(mediaActionSchema.safeParse({ ...action, following: [{ ...action.following[0], playable: true, requestedByUserId: '12345678901234567' }] }).success).toBe(false);
  });
  it('supplies conservative defaults and bounds operational limits', () => {
    const settings = mediaSettingsSchema.parse({}); expect(settings.enabled).toBe(false); expect(settings.allowRemoteAdminControl).toBe(false); expect(settings.maxQueueItems).toBe(100); expect(settings.skipVoteRatio).toBe(0.5);
    for (const value of [{ maxQueueItems: 101 }, { skipVoteRatio: 0 }, { defaultVolume: 90, maxVolume: 50 }, { maxTrackDurationSeconds: Infinity }]) expect(mediaSettingsSchema.safeParse(value).success).toBe(false);
  });
  it('rejects browser-supplied actors, arbitrary payloads and missing concurrency guards', () => {
    const request = { commandId: 'f5d12265-0d78-48f2-a1c6-ec72ef5c8eae', sessionId: null, expectedQueueVersion: null, action: { type: 'PAUSE' } };
    expect(mediaRequestSchema.safeParse(request).success).toBe(true);
    expect(mediaRequestSchema.safeParse({ ...request, actorUserId: '12345678901234567' }).success).toBe(false);
    expect(mediaRequestSchema.safeParse({ ...request, action: { type: 'PAUSE', voiceChannelId: '12345678901234567' } }).success).toBe(false);
    expect(mediaRequestSchema.safeParse({ commandId: request.commandId, sessionId: null, action: request.action }).success).toBe(false);
  });
});
