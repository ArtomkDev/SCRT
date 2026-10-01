import { describe, expect, it } from 'vitest';
import { readMemberSnapshot } from './member-snapshot';

const member = { id: '123456789012345678', username: 'user', globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/a.png', roleIds: [] };

describe('streamed member snapshots', () => {
  it('shows a page before the stream completes, even when JSON lines cross network chunks', async () => {
    const encoder = new TextEncoder();
    let finish!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const line = JSON.stringify({ kind: 'page', revision: 4, members: [member] }) + '\n';
        controller.enqueue(encoder.encode(line.slice(0, 25)));
        controller.enqueue(encoder.encode(line.slice(25)));
        finish = () => { controller.enqueue(encoder.encode(JSON.stringify({ kind: 'done', revision: 4 }) + '\n')); controller.close(); };
      },
    });
    const seen: string[] = [];
    const result = readMemberSnapshot(new Response(stream), (members) => seen.push(members[0]!.id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([member.id]);
    finish();
    await expect(result).resolves.toEqual({ startRevision: 4, endRevision: 4 });
  });
});
