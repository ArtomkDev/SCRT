import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { liveStream } from './live-stream';

describe('dashboard event stream', () => {
  it('delivers changes and releases the database listener when the client leaves', async () => {
    const request = new Request('http://localhost/events');
    const stop = vi.fn();
    let emit: (kind: string) => void = () => {};
    const response = liveStream(request, (notify) => { emit = notify; return stop; }, 'test');
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected');

    emit('rooms');
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: change\ndata: rooms');

    await reader.cancel();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not open a listener for an already closed request', () => {
    const abort = new AbortController();
    abort.abort();
    const subscribe = vi.fn(() => vi.fn());
    liveStream(new Request('http://localhost/events', { signal: abort.signal }), subscribe, 'test');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('disconnects slow consumers before their event buffer grows without bound', async () => {
    const stop = vi.fn();
    let emit!: (kind: string) => void;
    const response = liveStream(new Request('http://localhost/events'), (notify) => { emit = notify; return stop; }, 'slow');
    for (let i = 0; i < 100; i++) emit('x'.repeat(4096));
    expect(stop).toHaveBeenCalledOnce();
    const text = await response.text();
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(64 * 1024);
  });
});
