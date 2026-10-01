import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./server', () => ({ env: () => ({ SESSION_SECRET: 'installation-test-secret' }) }));
import { readInstallationState, signInstallationState } from './installation-state';

const input = { guildId: '123456789012345678', userId: '223456789012345678', state: 's'.repeat(43), verifier: 'v'.repeat(43) };
afterEach(() => vi.useRealTimers());

describe('installation state signature', () => {
  it('accepts only an unmodified server-issued, unexpired installation state', () => {
    vi.useFakeTimers();
    const value = signInstallationState(input);
    expect(readInstallationState(value)).toMatchObject(input);
    vi.advanceTimersByTime(600_000);
    expect(readInstallationState(value)).toBeNull();
  });
  it('rejects unsigned state and replacement guild, user or verifier fields', () => {
    expect(readInstallationState(JSON.stringify(input))).toBeNull();
    const value = signInstallationState(input);
    const [payload, signature] = value.split('.');
    for (const replacement of [{ guildId: '323456789012345678' }, { userId: '323456789012345678' }, { verifier: 'x'.repeat(43) }]) {
      const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')), ...replacement })).toString('base64url');
      expect(readInstallationState(`${changed}.${signature}`)).toBeNull();
    }
    expect(readInstallationState(`${payload}.bad`)).toBeNull();
  });
});
