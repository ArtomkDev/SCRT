import { describe, expect, it, vi } from 'vitest';
import { VoiceRepository } from './index';

const guildId = '123456789012345678';
const userId = '223456789012345678';
const channelId = '323456789012345678';

function fixture() {
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  const add = vi.fn(async (path: string, data: Record<string, unknown>) => {
    // Model Firestore's rejection: one undefined field rejects the entire event.
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) throw new Error(`Cannot use undefined as a Firestore value: ${key}`);
    }
    writes.push({ path, data });
  });
  const db = { collection: (collection: string) => ({ doc: (id: string) => ({
    collection: (child: string) => ({ add: (data: Record<string, unknown>) => add(`${collection}/${id}/${child}`, data) }),
  }) }) };
  return { writes, add, repo: new VoiceRepository(db as unknown as ConstructorParameters<typeof VoiceRepository>[0]) };
}

describe('Voice audit persistence', () => {
  it.each([
    { action: 'room.created', source: 'discord' as const, actorId: userId, targetUserId: undefined },
    { action: 'room.deleted', source: 'discord' as const, actorId: undefined },
    { action: 'voice.recovery', source: 'recovery' as const },
  ])('persists $action with absent identifiers instead of rejecting the event', async (event) => {
    const { repo, writes } = fixture();
    await repo.audit({ guildId, ...event });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(`guilds/${guildId}/voiceAudit`);
    expect(writes[0]?.data).toMatchObject({ guildId, action: event.action, source: event.source, actorId: event.actorId ?? null, targetUserId: null, channelId: null, creatorId: null });
    expect(writes[0]?.data.timestamp).toBeDefined();
  });

  it('retains supplied actor, target and room identifiers', async () => {
    const { repo, writes } = fixture();
    const event = { guildId, action: 'room.user_kicked', source: 'discord' as const, actorId: userId, targetUserId: '423456789012345678', channelId, creatorId: '523456789012345678' };
    await repo.audit(event);
    expect(writes[0]?.data).toMatchObject(event);
  });

  it('preserves explicit null values for an automatic operation', async () => {
    const { repo, writes } = fixture();
    await repo.audit({ guildId, action: 'room.owner_released', source: 'discord', actorId: null, targetUserId: null, channelId, creatorId: null });
    expect(writes[0]?.data).toMatchObject({ actorId: null, targetUserId: null, channelId, creatorId: null });
  });

  it('rejects an invalid guild before writing an audit', async () => {
    const { repo, add } = fixture();
    await expect(repo.audit({ guildId: '../another-guild', action: 'room.deleted', source: 'discord' })).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
  });
});
