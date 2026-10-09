import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { openAudioStream } from './audio-http';
afterEach(() => vi.clearAllMocks());
describe('audio HTTP redirect transport', () => {
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
});
