import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { MediaRepository } from './media-repository';
import { activityTestStore } from './activity-test-store';
import type { MediaHistoryItem, MediaSession } from '@scrt/shared';
const guildId = '12345678901234567', otherGuild = '22345678901234567';
const session = (): MediaSession => ({ sessionId: randomUUID(), guildId, voiceChannelId: '32345678901234567', voiceChannelName: 'Gaming', state: 'idle', currentTrack: null, queue: [], played: [], startedAt: null, pausedAt: null, accumulatedPauseMs: 0, volume: 60, repeatMode: 'off', queueMode: 'normal', shuffle: false, lockedMode: 'unlocked', createdByUserId: '42345678901234567', queueVersion: 0, revision: 0, createdAt: Date.now(), updatedAt: Date.now(), recoverable: false, lastError: null, lastRequesterId: null });
function historyItem(actor = '42345678901234567', endedAt = Date.now() - 1000): MediaHistoryItem {
  return { id: randomUUID(), track: { provider: 'youtube', providerItemId: 'abcdefghijk', title: 'Track', artist: 'Artist', type: 'track', durationMs: 60000, artworkUrl: null, externalUrl: 'https://youtube.com/watch?v=abcdefghijk', playable: true, seekable: false, explicit: null, queueItemId: randomUUID(), requestedByUserId: actor, requestedByName: 'Listener', requestedAt: endedAt - 2000 }, playedAt: endedAt - 1000, endedAt, result: 'finished', reason: null };
}
describe('Media Firestore transaction boundary', () => {
  it('filters retired providers when reading old sessions while preserving supported tracks and guild isolation', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const track = historyItem().track;
    const retired = { ...track, provider: 'spotify' };
    const legacy = { ...session(), state: 'playing', currentTrack: retired, queue: [retired, track], played: [{ ...retired, provider: 'radio' }, track], startedAt: Date.now() };
    fixture.records.set(`guilds/${guildId}/mediaState/current`, legacy);
    const restored = await repo.getSession(guildId);
    expect(restored).toMatchObject({ state: 'idle', currentTrack: null, queue: [track], played: [track], recoverable: true, startedAt: null });
    expect(restored?.lastError).toContain('більше не підтримується');
    expect(fixture.records.get(`guilds/${guildId}/mediaState/current`)).toEqual(legacy);
    expect(await repo.getSession(otherGuild)).toBeNull();
    fixture.records.set(`guilds/${guildId}/mediaState/current`, { ...session(), queue: [{ ...track, provider: 'forged' }] });
    await expect(repo.getSession(guildId)).rejects.toThrow();
  });
  it('continues history pagination across a page containing only retired sources', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const endedAt = Date.now() - 1000;
    const retired = Array.from({ length: 25 }, (_, index) => { const item = historyItem(undefined, endedAt - index); return { ...item, track: { ...item.track, provider: index % 2 ? 'radio' : 'spotify' } }; });
    for (const item of retired) fixture.records.set(`guilds/${guildId}/mediaHistory/${item.id}`, item);
    const supported = historyItem(undefined, endedAt - 30);
    fixture.records.set(`guilds/${guildId}/mediaHistory/${supported.id}`, supported);
    const first = await repo.history(guildId);
    expect(first.items).toEqual([]); expect(first.next).toEqual({ id: retired[24]!.id, endedAt: retired[24]!.endedAt });
    expect(await repo.history(guildId, first.next!.endedAt, 25, first.next!.id)).toEqual({ items: [supported], next: null });
  });
  it('deletes only the actor history in the requested guild, even when another actor is an owner', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const own = historyItem(); const other = historyItem('52345678901234567');
    const path = (guild: string, id: string) => `guilds/${guild}/mediaHistory/${id}`;
    fixture.records.set(path(guildId, own.id), own); fixture.records.set(path(otherGuild, own.id), own); fixture.records.set(path(guildId, other.id), other);
    fixture.records.set(`guilds/${guildId}/mediaState/current`, session());
    expect(await repo.deleteHistoryItem(guildId, other.id, own.track.requestedByUserId)).toBe('forbidden');
    expect(await repo.deleteHistoryItem(guildId, own.id, own.track.requestedByUserId)).toBe('deleted');
    expect(await repo.deleteHistoryItem(guildId, own.id, own.track.requestedByUserId)).toBe('missing');
    expect(fixture.records.has(path(guildId, own.id))).toBe(false);
    expect(fixture.records.get(path(otherGuild, own.id))).toEqual(own); expect(fixture.records.get(path(guildId, other.id))).toEqual(other);
    expect((await repo.getSession(guildId))?.volume).toBe(60);
    await expect(repo.deleteHistoryItem('../guild', own.id, own.track.requestedByUserId)).rejects.toThrow();
    await expect(repo.deleteHistoryItem(guildId, '../entry', own.track.requestedByUserId)).rejects.toThrow();
    await expect(repo.clearOwnHistory(guildId, 'forged')).rejects.toThrow();
  });
  it('clears large own histories in bounded batches without a composite index or touching other users/guilds', async () => {
    const fixture = activityTestStore(true); const repo = new MediaRepository(fixture.db); const actor = '42345678901234567';
    for (let i = 0; i < 105; i++) { const item = historyItem(actor); fixture.records.set(`guilds/${guildId}/mediaHistory/${item.id}`, item); }
    const other = historyItem('52345678901234567'); const elsewhere = historyItem(actor);
    fixture.records.set(`guilds/${guildId}/mediaHistory/${other.id}`, other); fixture.records.set(`guilds/${otherGuild}/mediaHistory/${elsewhere.id}`, elsewhere);
    expect(await repo.clearOwnHistory(guildId, actor)).toEqual({ deleted: 100, more: true });
    expect(await repo.clearOwnHistory(guildId, actor)).toEqual({ deleted: 5, more: false });
    expect(await repo.clearOwnHistory(guildId, actor)).toEqual({ deleted: 0, more: false });
    expect([...fixture.records.values()]).toEqual([other, elsewhere]);
    expect(fixture.queries.every((query) => query.limit === 100 && query.filters[0]?.value === actor)).toBe(true);
  });
  it('rechecks ownership inside cleanup transactions rather than trusting the earlier query', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const item = historyItem(); const path = `guilds/${guildId}/mediaHistory/${item.id}`;
    fixture.records.set(path, item);
    const transaction = fixture.db.runTransaction.bind(fixture.db);
    vi.spyOn(fixture.db, 'runTransaction').mockImplementation((work) => {
      fixture.records.set(path, { ...item, track: { ...item.track, requestedByUserId: '52345678901234567' } });
      return transaction(work);
    });
    expect(await repo.clearOwnHistory(guildId, item.track.requestedByUserId)).toEqual({ deleted: 0, more: false });
    expect(fixture.records.has(path)).toBe(true);
  });
  it('paginates equal end times by document ID even after the cursor record was deleted', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const endedAt = Date.now() - 1000;
    const items = Array.from({ length: 30 }, () => historyItem('42345678901234567', endedAt)).sort((a, b) => b.id.localeCompare(a.id));
    for (const item of items) fixture.records.set(`guilds/${guildId}/mediaHistory/${item.id}`, { ...item, privateField: 'stripped' });
    const page = await repo.history(guildId); expect(page.items).toEqual(items.slice(0, 25));
    await repo.deleteHistoryItem(guildId, page.next!.id, items[0]!.track.requestedByUserId);
    const next = await repo.history(guildId, page.next!.endedAt, 25, page.next!.id);
    expect(next).toEqual({ items: items.slice(25), next: null });
  });
  it('loads existing documents without played metadata and persists retained tracks atomically', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const value = session();
    const legacy: Partial<MediaSession> = { ...value }; delete legacy.played;
    fixture.records.set(`guilds/${guildId}/mediaState/current`, legacy);
    expect((await repo.getSession(guildId))?.played).toEqual([]);
    const track = { provider: 'direct' as const, providerItemId: 'https://audio.example/test.mp3', title: 'Track', artist: 'Artist', type: 'track' as const, durationMs: 60000, artworkUrl: null, externalUrl: 'https://audio.example/test.mp3', playable: true, seekable: false, explicit: null, queueItemId: randomUUID(), requestedByUserId: value.createdByUserId, requestedByName: 'Listener', requestedAt: Date.now() };
    await repo.checkpoint({ ...value, played: [track], revision: 1 }, 0, [], { action: 'track.finished', actorId: null });
    expect((await repo.getSession(guildId))?.played).toEqual([track]); expect(await repo.getSession(otherGuild)).toBeNull();
  });
  it('avoids a redundant settings read for controls while preserving configured history retention', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const value = session();
    const settings = vi.spyOn(repo, 'getSettings');
    await repo.checkpoint(value, null, [], { action: 'volume.changed', actorId: null });
    expect(settings).not.toHaveBeenCalled();
    fixture.records.set(`guilds/${guildId}/mediaSettings/main`, { historyRetentionDays: 7 });
    const track = { provider: 'direct' as const, providerItemId: 'https://audio.example/test.mp3', title: 'Track', artist: 'Artist', type: 'track' as const, durationMs: 60000, artworkUrl: null, externalUrl: 'https://audio.example/test.mp3', playable: true, seekable: false, explicit: null, queueItemId: randomUUID(), requestedByUserId: value.createdByUserId, requestedByName: 'Listener', requestedAt: Date.now() };
    const endedAt = Date.now(); const historyId = randomUUID();
    await repo.checkpoint({ ...value, revision: 1 }, 0, [{ id: historyId, track, playedAt: endedAt - 1000, endedAt, result: 'finished', reason: null }], { action: 'track.finished', actorId: null });
    expect(settings).toHaveBeenCalledOnce();
    expect(fixture.records.get(`guilds/${guildId}/mediaHistory/${historyId}`)).toMatchObject({ expiresAt: expect.anything() });
    // The in-memory test store clones documents and intentionally drops prototypes.
    const expiresAt = fixture.records.get(`guilds/${guildId}/mediaHistory/${historyId}`)!.expiresAt;
    expect(expiresAt).toEqual(structuredClone(Timestamp.fromMillis(endedAt + 7 * 86400000)));
  });
  it('atomically scopes state/audit/receipt, rejects stale revision and leaves other guilds untouched', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db); const value = session(); const commandId = randomUUID();
    fixture.records.set(`guilds/${otherGuild}/mediaState/current`, { marker: 'unrelated' });
    await repo.checkpoint(value, null, [], { action: 'session.started', actorId: value.createdByUserId }, { commandId, fingerprint: 'fingerprint' });
    expect(await repo.getSession(guildId)).toEqual(value); expect(await repo.receipt(guildId, commandId)).toEqual({ fingerprint: 'fingerprint' }); expect(await repo.receipt(otherGuild, commandId)).toBeNull();
    await expect(repo.checkpoint({ ...value, revision: 1, volume: 80 }, null, [], { action: 'volume.changed', actorId: null })).rejects.toThrow('conflict'); expect((await repo.getSession(guildId))?.volume).toBe(60);
    expect(fixture.records.get(`guilds/${otherGuild}/mediaState/current`)).toEqual({ marker: 'unrelated' });
  });
  it('validates guild paths and serializes no audio or undefined metadata', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db);
    await expect(repo.getSession('../guild')).rejects.toThrow(); expect(fixture.records.size).toBe(0);
    await repo.checkpoint(session(), null, [], { action: 'session.started', actorId: null }); const data = JSON.stringify([...fixture.records.values()]); expect(data).not.toContain('audioBytes'); expect(data).not.toContain('streamUrl');
  });
  it('exclusively leases a guild and permits takeover only after expiry/release', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db);
    expect(await repo.lease(guildId, 'worker-a')).toBe(true); expect(await repo.lease(guildId, 'worker-b')).toBe(false); expect(await repo.lease(otherGuild, 'worker-b')).toBe(true);
    await repo.lease(guildId, 'worker-a', true); expect(await repo.lease(guildId, 'worker-b')).toBe(true);
  });
  it('does not replace another worker lease when a stale worker releases it', async () => {
    const fixture = activityTestStore(); const repo = new MediaRepository(fixture.db);
    const path = `guilds/${guildId}/mediaLease/worker`;
    const expiredLease = { workerId: 'worker-a', expiresAt: Date.now() - 1000 };
    fixture.records.set(path, expiredLease);
    expect(await repo.lease(guildId, 'worker-b', true)).toBe(false);
    expect(fixture.records.get(path)).toEqual(expiredLease);
    expect(await repo.lease(otherGuild, 'worker-b', true)).toBe(false);
    expect(fixture.records.has(`guilds/${otherGuild}/mediaLease/worker`)).toBe(false);
  });
});
