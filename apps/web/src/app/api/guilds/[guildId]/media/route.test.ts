import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaSettingsSchema, mediaSnapshotSchema } from '@scrt/validation';
const mocks = vi.hoisted(() => ({ token: vi.fn(), session: vi.fn(), access: vi.fn(), state: vi.fn(), internal: vi.fn(), history: vi.fn(), deleteHistory: vi.fn(), clearHistory: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access, requireSession: mocks.session }));
vi.mock('@/lib/session', () => ({ accessToken: mocks.token }));
vi.mock('@/lib/server', () => ({ env: () => ({ NEXT_PUBLIC_APP_URL: 'https://scrt.example' }), media: () => ({ history: mocks.history, deleteHistoryItem: mocks.deleteHistory, clearOwnHistory: mocks.clearHistory }) }));
vi.mock('@/lib/media-data', () => ({ mediaSnapshot: mocks.state, mediaInternal: mocks.internal, MediaTransportError: class extends Error { constructor(message: string, readonly status: number) { super(message); } } }));
import { MediaTransportError } from '@/lib/media-data';
import { DELETE, GET, PATCH, POST } from './route';
const guildId = '12345678901234567', userId = '22345678901234567'; const context = { params: Promise.resolve({ guildId }) };
const command = { commandId: 'f5d12265-0d78-48f2-a1c6-ec72ef5c8eae', sessionId: null, expectedQueueVersion: null, action: { type: 'PLAY_TRACK', provider: 'direct', providerItemId: 'https://audio.example/file.mp3' } };
const request = (body: unknown, origin = 'https://scrt.example') => new Request(`https://scrt.example/api/guilds/${guildId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
const snapshot = mediaSnapshotSchema.parse({ settings: mediaSettingsSchema.parse({ enabled: true }), session: null, actorVoice: { id: null, name: null }, controls: {}, queueControls: {}, remoteControl: false, listenerCount: 0, votes: { count: 0, required: 1 }, providers: [], engine: { available: true, ffmpeg: true, opus: true, dave: true }, canManage: true, serverTimestamp: 1 });
beforeEach(() => { vi.clearAllMocks(); mocks.token.mockResolvedValue('session'); mocks.session.mockResolvedValue({ user: { id: userId } }); mocks.access.mockResolvedValue({ user: { id: userId } }); mocks.state.mockResolvedValue(snapshot); mocks.internal.mockResolvedValue({ replayed: false, snapshot }); mocks.history.mockResolvedValue({ items: [], next: null }); });
describe('Media web identity and worker authorization boundary', () => {
  it('deletes an own history item using the signed-in actor after checking live guild access', async () => {
    mocks.deleteHistory.mockResolvedValue('deleted'); const id = command.commandId;
    const response = await DELETE(request({ type: 'DELETE_ITEM', id }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ deleted: 1, more: false });
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'media.view');
    expect(mocks.deleteHistory).toHaveBeenCalledExactlyOnceWith(guildId, id, userId);
    mocks.deleteHistory.mockResolvedValue('forbidden');
    expect((await DELETE(request({ type: 'DELETE_ITEM', id }), context)).status).toBe(403);
    expect(mocks.internal).not.toHaveBeenCalled();
  });
  it('rechecks membership for every own-history cleanup batch and rejects forged identities/cross-origin writes', async () => {
    mocks.clearHistory.mockResolvedValue({ deleted: 100, more: true });
    expect(await (await DELETE(request({ type: 'CLEAR_OWN' }), context)).json()).toEqual({ deleted: 100, more: true });
    expect(mocks.clearHistory).toHaveBeenCalledExactlyOnceWith(guildId, userId);
    mocks.clearHistory.mockClear(); mocks.access.mockRejectedValue(new Error('Forbidden'));
    expect((await DELETE(request({ type: 'CLEAR_OWN' }), context)).status).toBe(403);
    expect(mocks.clearHistory).not.toHaveBeenCalled(); mocks.access.mockResolvedValue({ user: { id: userId } });
    expect((await DELETE(request({ type: 'CLEAR_OWN', actorUserId: guildId }), context)).status).toBe(400);
    expect((await DELETE(request({ type: 'DELETE_ITEM', id: '../entry' }), context)).status).toBe(400);
    expect((await DELETE(request({ type: 'CLEAR_OWN' }, 'https://evil.example'), context)).status).toBe(403);
    mocks.token.mockResolvedValue(null);
    expect((await DELETE(request({ type: 'CLEAR_OWN' }), context)).status).toBe(401);
    expect(mocks.clearHistory).not.toHaveBeenCalled(); expect(mocks.deleteHistory).not.toHaveBeenCalled();
  });
  it('forwards bounded pagination using server identity and rejects invalid pages before the worker', async () => {
    mocks.internal.mockResolvedValue({ results: [], unavailable: [], nextPage: 2 });
    const response = await GET(new Request('https://scrt.example?q=track&page=1&actorUserId=forged'), context);
    expect(await response.json()).toEqual({ results: [], unavailable: [], errors: [], nextPage: 2 });
    expect(mocks.internal).toHaveBeenCalledExactlyOnceWith({ operation: 'search', guildId, actorUserId: userId, query: 'track', page: 1 });
    mocks.internal.mockClear();
    for (const page of ['-1', '10', '1.5', 'invalid']) expect((await GET(new Request(`https://scrt.example?q=track&page=${page}`), context)).status).toBe(400);
    expect(mocks.internal).not.toHaveBeenCalled();
  });
  it('uses one worker command and returns its confirmed state without preflight or refresh reads', async () => {
    const response = await POST(request(command), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ replayed: false, snapshot });
    expect(mocks.internal).toHaveBeenCalledExactlyOnceWith({ operation: 'command', command: { ...command, guildId, actorUserId: userId } });
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.state).not.toHaveBeenCalled();
    expect((await POST(request({ ...command, actorUserId: 'forged' }), context)).status).toBe(400);
  });
  it('rejects unauthenticated requests before any guild operation', async () => {
    mocks.token.mockResolvedValue(null);
    expect((await GET(new Request('https://scrt.example'), context)).status).toBe(401);
    expect((await POST(request(command), context)).status).toBe(401);
    expect((await PATCH(request(mediaSettingsSchema.parse({})), context)).status).toBe(401);
    expect(mocks.internal).not.toHaveBeenCalled(); expect(mocks.state).not.toHaveBeenCalled(); expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([403, 409, 429, 503])('preserves worker policy, conflict and availability failure %s', async (status) => {
    mocks.internal.mockRejectedValue(new MediaTransportError('Worker denied', status));
    const response = await POST(request(command), context);
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: 'Worker denied' });
  });
  it('rejects cross-origin, unknown guilds and arbitrary payloads without reaching the worker', async () => {
    expect((await POST(request(command, 'https://evil.example'), context)).status).toBe(403);
    expect((await POST(request(command), { params: Promise.resolve({ guildId: '../guild' }) })).status).toBe(400);
    expect((await POST(request({ ...command, action: { type: 'DISCORD_MOVE', channelId: userId } }), context)).status).toBe(400);
    expect(mocks.internal).not.toHaveBeenCalled();
  });
  it('still establishes live guild access before reading history directly from Firestore', async () => {
    expect((await GET(new Request('https://scrt.example?history=1'), context)).status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith(guildId, 'media.view');
    mocks.history.mockClear(); mocks.access.mockRejectedValue(new Error('Forbidden'));
    expect((await GET(new Request('https://scrt.example?history=1'), context)).status).toBe(403); expect(mocks.history).not.toHaveBeenCalled();
  });
  it('forwards settings with the session identity and honors live worker management denial', async () => {
    const settings = mediaSettingsSchema.parse({ enabled: true }); mocks.internal.mockResolvedValue(settings);
    expect((await PATCH(request(settings), context)).status).toBe(200);
    expect(mocks.internal).toHaveBeenCalledWith({ operation: 'settings', guildId, actorUserId: userId, settings });
    mocks.internal.mockRejectedValue(new MediaTransportError('Потрібен media.manage', 403));
    expect((await PATCH(request(settings), context)).status).toBe(403);
  });
  it('strips unexpected upstream fields from commands and provider search responses', async () => {
    mocks.internal.mockResolvedValue({ replayed: false, snapshot, privateStreamUrl: 'https://cdn.example/?secret=value' });
    expect(await (await POST(request(command), context)).json()).toEqual({ replayed: false, snapshot });
    mocks.internal.mockResolvedValue({ results: [], unavailable: ['YouTube'], errors: ['YouTube вимагає авторизації.'], privateStreamUrl: 'secret' });
    const response = await GET(new Request('https://scrt.example?q=track'), context);
    expect(await response.json()).toEqual({ results: [], unavailable: ['YouTube'], errors: ['YouTube вимагає авторизації.'], nextPage: null });
  });
});
