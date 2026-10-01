import type { DirectoryEvent, DirectoryMember } from '@scrt/validation';

export function applyMemberEvent(members: Map<string, DirectoryMember>, event: DirectoryEvent): void {
  if (event.kind !== 'change') return;
  if (event.change.kind === 'remove') members.delete(event.change.memberId);
  else members.set(event.change.member.id, event.change.member);
}

// Replay changes made while Discord's pages were in flight, without scanning again.
export function reconcileMemberSnapshot(members: Map<string, DirectoryMember>, startRevision: number, endRevision: number, events: readonly DirectoryEvent[], observedRevision: number): number | null {
  if (endRevision < startRevision) return null;
  let revision = startRevision;
  for (const event of [...events].sort((a, b) => a.revision - b.revision)) {
    if (event.kind === 'sync' || event.revision <= revision) continue;
    if (event.kind === 'reset' || event.revision !== revision + 1) return null;
    applyMemberEvent(members, event);
    revision = event.revision;
  }
  return revision >= Math.max(endRevision, observedRevision) ? revision : null;
}
