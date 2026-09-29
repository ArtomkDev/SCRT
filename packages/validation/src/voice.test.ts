import { describe, expect, it } from 'vitest';
import { renderVoiceRoomName, voiceCreatorSchema, voiceSettingsSchema } from './index';

describe('Voice configuration', () => {
  it('rejects impossible cleanup and room limits', () => {
    expect(() => voiceSettingsSchema.parse({ cleanupDelaySeconds: 3601 })).toThrow();
    expect(() => voiceSettingsSchema.parse({ maxRoomsPerUser: 0 })).toThrow();
  });
  it('validates creator IDs and channel defaults', () => {
    const base = { id: '12345678901234567', guildId: '22345678901234567', channelId: '12345678901234567' };
    expect(voiceCreatorSchema.parse(base)).toMatchObject({ enabled: true, roomPlacement: 'bottom', roomOrder: 'oldest_first' });
    expect(() => voiceCreatorSchema.parse({ ...base, defaultUserLimit: 100 })).toThrow();
    expect(() => voiceCreatorSchema.parse({ ...base, roomPlacement: 'sideways' })).toThrow();
  });
  it('renders supported variables and rejects malformed names', () => {
    expect(renderVoiceRoomName('🎧 {displayName} {counter}', { username: 'artom', displayName: 'ARTOMK', counter: 2 })).toBe('🎧 ARTOMK 2');
    expect(renderVoiceRoomName('{serverName} · {creatorName} · {highestRole} · {privacy}', {
      username: 'artom', displayName: 'Артем', counter: 2, serverName: 'SCRT', creatorName: 'Створити', highestRole: 'Модератор', privacy: 'locked',
    })).toBe('SCRT · Створити · Модератор · Закрита');
    expect(renderVoiceRoomName('{counterRoman} {counterAlpha} {counterPadded} {counterSuperscript}', {
      username: 'a', displayName: 'b', counter: 27,
    })).toBe('XXVII AA 27 ²⁷');
    expect(renderVoiceRoomName('{accountCreated} / {serverJoined} / {hoistRole}', {
      username: 'a', displayName: 'b', counter: 1, accountCreatedAt: Date.UTC(2021, 3, 12), serverJoinedAt: null,
    })).toBe('12.04.2021 / невідомо / Без ролі');
    expect(renderVoiceRoomName('{displayName}', { username: 'a', displayName: 'Артем {VIP}', counter: 1 })).toBe('Артем {VIP}');
    expect(() => renderVoiceRoomName('{secret}', { username: 'a', displayName: 'b', counter: 1 })).toThrow();
    expect(() => renderVoiceRoomName('{username', { username: 'a', displayName: 'b', counter: 1 })).toThrow();
    expect(() => renderVoiceRoomName('   ', { username: 'a', displayName: 'b', counter: 1 })).toThrow();
    expect(() => renderVoiceRoomName('a'.repeat(101), { username: 'a', displayName: 'b', counter: 1 })).toThrow();
  });
});
