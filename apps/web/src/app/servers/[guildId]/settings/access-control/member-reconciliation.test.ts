import { describe, expect, it } from 'vitest';
import type { DirectoryMember } from '@scrt/validation';
import { reconcileMemberSnapshot } from './member-reconciliation';

const member = (id: string): DirectoryMember => ({ id, username: id, globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/a.png', roleIds: [] });
const snapshot = () => new Map([['one', member('one')], ['two', member('two')]]);

describe('directory changes during a snapshot', () => {
  it('replays joins, leaves and profile changes without restarting a full scan', () => {
    const members = snapshot();
    const revision = reconcileMemberSnapshot(members, 7, 10, [
      { kind: 'sync', revision: 7 },
      { kind: 'change', revision: 8, change: { kind: 'remove', memberId: 'one' } },
      { kind: 'change', revision: 9, change: { kind: 'upsert', member: member('three') } },
      { kind: 'change', revision: 10, change: { kind: 'upsert', member: { ...member('two'), nick: 'Updated' } } },
    ], 10);
    expect(revision).toBe(10);
    expect([...members.keys()]).toEqual(['two', 'three']);
    expect(members.get('two')?.nick).toBe('Updated');
  });

  it('accepts scoped no-op events and ignores duplicates and old changes', () => {
    expect(reconcileMemberSnapshot(snapshot(), 7, 8, [
      { kind: 'reset', revision: 6 }, { kind: 'advance', revision: 8 }, { kind: 'advance', revision: 8 },
    ], 8)).toBe(8);
  });

  it('requires a reload when events are missing or the server resets', () => {
    expect(reconcileMemberSnapshot(snapshot(), 7, 9, [{ kind: 'advance', revision: 9 }], 9)).toBeNull();
    expect(reconcileMemberSnapshot(snapshot(), 7, 8, [{ kind: 'reset', revision: 8 }], 8)).toBeNull();
    expect(reconcileMemberSnapshot(snapshot(), 7, 7, [{ kind: 'sync', revision: 9 }], 9)).toBeNull();
  });
});
