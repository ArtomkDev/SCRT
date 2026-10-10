import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, runtimeLogSnapshot } from './index';

afterEach(() => vi.restoreAllMocks());

describe('Worker log export', () => {
  it('redacts credentials and signed source addresses before retaining or printing them', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log('error', 'media', 'failed', { token: 'private-token', url: 'https://cdn.example/audio?signature=private-signature' }, new Error('Authorization=private-secret Bearer private-bearer'));
    const text = JSON.stringify(runtimeLogSnapshot().entries.at(-1));
    for (const secret of ['private-token', 'private-signature', 'private-secret', 'private-bearer']) { expect(text).not.toContain(secret); expect(output.mock.calls[0]![0]).not.toContain(secret); }
  });
  it('bounds retention and pages by process identity without sharing mutable entries', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    for (let i = 0; i < 5002; i++) log('info', 'test', 'bounded', { i });
    const snapshot = runtimeLogSnapshot(); expect(snapshot.entries).toHaveLength(5000); expect(snapshot.dropped).toBeGreaterThan(0);
    const first = runtimeLogSnapshot({ runId: '', after: 999999 }); expect(first.entries).toHaveLength(500);
    const second = runtimeLogSnapshot({ runId: first.runId, after: first.entries.at(-1)!.sequence });
    expect(second.entries[0]!.sequence).toBe(first.entries.at(-1)!.sequence + 1);
    first.entries[0]!.context.i = 'changed'; expect(runtimeLogSnapshot().entries[0]!.context.i).not.toBe('changed');
  });
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
  it('reports nested aggregate network codes even when the cause message is empty', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refused = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const unreachable = Object.assign(new Error('https://private.example/?token=private-signature'), { code: 'ENETUNREACH' });
    const failure = new TypeError('fetch failed', { cause: new AggregateError([refused, unreachable], '') });
    log('error', 'media', 'worker.request.failed', {}, failure);
    const entry = runtimeLogSnapshot().entries.at(-1)!;
    expect(entry.message).toContain('ECONNREFUSED'); expect(entry.message).toContain('ENETUNREACH');
    expect(entry.message).toContain('AggregateError'); expect(entry.message).not.toContain('private-signature');
    expect(output.mock.calls[0]![0]).not.toContain('private-signature');
  });
  it('bounds cyclic and excessive error causes without losing the primary failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cycle = new Error('primary failure'); cycle.cause = cycle;
    expect(() => log('error', 'bot', 'uncaught-exception', {}, cycle)).not.toThrow();
    expect(runtimeLogSnapshot().entries.at(-1)!.message).toContain('primary failure');
    const huge = new AggregateError(Array.from({ length: 100 }, (_, i) => new Error(`child-${i} ${'x'.repeat(8000)}`)), 'primary aggregate');
    log('error', 'media', 'failed', {}, huge);
    expect(runtimeLogSnapshot().entries.at(-1)!.message).toContain('primary aggregate');
    expect(runtimeLogSnapshot().entries.at(-1)!.message.length).toBeLessThanOrEqual(4000);
  });
});
