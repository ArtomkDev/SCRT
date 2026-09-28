import { describe, expect, it } from 'vitest';
import { canManageGuild, installUrl } from './index';

const guild = { id: '12345678901234567', name: 'Test', icon: null, owner: false, permissions: '0' };
describe('Discord guild selection', () => {
  it('allows server owners and Manage Server permission', () => {
    expect(canManageGuild({ ...guild, owner: true })).toBe(true);
    expect(canManageGuild({ ...guild, permissions: '32' })).toBe(true);
    expect(canManageGuild({ ...guild, permissions: '8' })).toBe(true);
    expect(canManageGuild(guild)).toBe(false);
  });
  it('requests only the current bot permissions', () => {
    const url = new URL(installUrl('12345678901234567', guild.id));
    expect(url.searchParams.get('permissions')).toBe('0');
    expect(url.searchParams.get('guild_id')).toBe(guild.id);
  });
});
