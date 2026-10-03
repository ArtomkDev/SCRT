import * as React from 'react';
import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.stubGlobal('React', React);
const mocks = vi.hoisted(() => ({ settings: vi.fn(), access: vi.fn(), records: vi.fn(), child: vi.fn() }));
vi.mock('@/lib/activity-data', () => ({ activitySettings: mocks.settings }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/voice-data', () => ({ voiceRecords: mocks.records }));
vi.mock('@/app/components/action-form', () => ({ ActionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock('../servers/[guildId]/activity/actions', () => ({ enableActivity: vi.fn() }));
vi.mock('../servers/[guildId]/voice/actions', () => ({ enableVoice: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch: vi.fn() }) }));
import { ActivityModuleContent } from '../servers/[guildId]/activity/module-content';
import VoiceOverview from '../servers/[guildId]/voice/page';
const guildId = '12345678901234567';
function SensitiveAnalytics() { mocks.child(); return <p>Private analytics</p>; }
async function html(tree: React.ReactNode) {
  return new Promise<string>((resolve, reject) => {
    let output = '';
    const sink = new Writable({ write(chunk: Buffer, _encoding, done) { output += chunk.toString(); done(); } });
    sink.on('finish', () => resolve(output));
    const stream = renderToPipeableStream(tree, { onAllReady() { stream.pipe(sink); }, onError: reject });
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ permissions: new Set(['activity.view', 'voice.view']) }); });
describe('module page state and mutation visibility', () => {
  it('does not execute analytics or expose enable mutations for disabled read-only Activity', async () => {
    mocks.settings.mockResolvedValue({ enabled: false });
    const output = await html(<ActivityModuleContent guildId={guildId}><SensitiveAnalytics /></ActivityModuleContent>);
    expect(mocks.child).not.toHaveBeenCalled();
    expect(output).toContain('Історичні дані збережено');
    expect(output).not.toContain('Увімкнути активність');
    expect(output).toContain(`/servers/${guildId}/activity/settings`);
  });
  it('renders enabled Activity analytics without a disabled panel', async () => {
    mocks.settings.mockResolvedValue({ enabled: true });
    const output = await html(<ActivityModuleContent guildId={guildId}><SensitiveAnalytics /></ActivityModuleContent>);
    expect(mocks.child).toHaveBeenCalledOnce(); expect(output).toContain('Private analytics');
    expect(output).not.toContain('module-state-panel');
  });
  it.each([false, true])('keeps disabled Voice settings and room management reachable (manage=%s)', async (manage) => {
    mocks.access.mockResolvedValue({ permissions: new Set(['voice.view', ...(manage ? ['voice.manage'] : [])]) });
    mocks.records.mockResolvedValue({ settings: { enabled: false }, creators: [], rooms: [] });
    const output = await html(await VoiceOverview({ params: Promise.resolve({ guildId }) }));
    expect(output).toContain('Голосові канали вимкнено');
    expect(output).toContain(`/servers/${guildId}/voice/settings`); expect(output).toContain(`/servers/${guildId}/voice/rooms`);
    expect(output.includes('Увімкнути голосові канали')).toBe(manage); expect(output).not.toContain('<dd>0</dd>');
  });
});
