import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { audioStreamRequestId, mediaDestination, openAudioStream } from './audio-http';
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe('audio HTTP redirect transport', () => {
  it('clears the DNS deadline after success and reports a stalled resolution without opening a request', async () => {
    vi.useFakeTimers();
    await mediaDestination('https://audio.example/a', async () => [{ address: '8.8.8.8', family: 4 }]);
    expect(vi.getTimerCount()).toBe(0);
    const pending = openAudioStream('https://audio.example/a', undefined, 0, () => new Promise(() => undefined));
    const failure = expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT', message: 'DNS timeout' });
    await vi.advanceTimersByTimeAsync(5000); await failure;
    expect(mocks.request).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('marks the actual connection deadline as retryable without changing DNS pinning', async () => {
    vi.useFakeTimers();
    mocks.request.mockImplementationOnce(() => {
      const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void; destroy: (error: Error) => void };
      req.setTimeout = vi.fn(); req.end = vi.fn(); req.destroy = (error) => { req.emit('error', error); }; return req;
    });
    const pending = openAudioStream('https://audio.example/track', undefined, 0, async () => [{ address: '8.8.8.8', family: 4 }]);
    const failure = expect(pending).rejects.toMatchObject({ message: 'Audio connection timeout', code: 'ETIMEDOUT' });
    await vi.advanceTimersByTimeAsync(8000); await failure; expect(mocks.request).toHaveBeenCalledOnce();
  });
  function response(status: number, headers: Record<string, string>) { const stream = new PassThrough() as unknown as IncomingMessage; Object.assign(stream, { statusCode: status, headers }); return stream; }
  function transport(reply: IncomingMessage) { mocks.request.mockImplementationOnce((_url, options, accept) => {
    const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void; destroy: () => void };
    req.setTimeout = vi.fn(); req.destroy = vi.fn(); req.end = () => { req.emit('response', reply); accept(reply); };
    expect(options.autoSelectFamily).toBe(false);
    let address: string | undefined; options.lookup('audio.example', {}, (_error: unknown, value: string) => { address = value; }); expect(address).toBe('8.8.8.8');
    return req;
  }); }
  it('blocks a redirect into private infrastructure before opening a second connection', async () => {
    const redirect = response(302, { location: 'http://169.254.169.254/latest/meta-data/' }); transport(redirect);
    await expect(openAudioStream('https://audio.example/file', undefined, 0, async () => [{ address: '8.8.8.8', family: 4 }])).rejects.toThrow('Приватні'); expect(mocks.request).toHaveBeenCalledTimes(1); expect(redirect.destroyed).toBe(true);
  });
  it('pins a fresh validated address at every public redirect and rejects HTML', async () => {
    transport(response(302, { location: 'https://cdn.example/file' })); const audio = response(200, { 'content-type': 'audio/mpeg' }); transport(audio);
    const dns = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]); const stream = await openAudioStream('https://audio.example/file', undefined, 0, dns); expect(stream).toBe(audio); expect(dns).toHaveBeenCalledTimes(2); stream.destroy();
    transport(response(200, { 'content-type': 'text/html' })); await expect(openAudioStream('https://audio.example/file', undefined, 0, dns)).rejects.toThrow('аудіопотік');
  });
  it('keeps buffered audio unread while recording transport metadata and a stream identity', async () => {
    const audio = response(200, { 'content-type': 'audio/mpeg', 'content-length': '4' });
    const bytes = Buffer.from([1, 2, 3, 4]); (audio as unknown as PassThrough).write(bytes); transport(audio);
    const stream = await openAudioStream('https://audio.example/file', undefined, 0, async () => [{ address: '8.8.8.8', family: 4 }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(audioStreamRequestId(stream)).toMatch(/^[0-9a-f-]{36}$/);
    expect(stream.readableFlowing).not.toBe(true); expect(stream.read(4)).toEqual(bytes);
    stream.destroy();
  });
});
