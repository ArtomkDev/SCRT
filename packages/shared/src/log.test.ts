import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from './index';

afterEach(() => vi.restoreAllMocks());

describe('Worker log export', () => {
  it('includes the action and guild in the message field used by hosted log viewers', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    log('info', 'activity', 'recovery.complete', { guildId: '12345678901234567', enabled: true });
    const entry = JSON.parse(output.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(entry.message).toContain('activity/recovery.complete');
    expect(entry.message).toContain('12345678901234567');
    expect(entry).toMatchObject({ module: 'activity', action: 'recovery.complete', guildId: '12345678901234567', enabled: true });
  });
  it('keeps the failure reason visible alongside the action and guild', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log('error', 'activity', 'recovery.failed', { guildId: '12345678901234567' }, new Error('Firestore unavailable'));
    const entry = JSON.parse(output.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(entry.message).toContain('activity/recovery.failed');
    expect(entry.message).toContain('Firestore unavailable');
    expect(entry.stack).toBeTypeOf('string');
  });
});
