import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeLogSnapshot } from '@scrt/shared';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { openAudioStream } from './audio-http';
import { audioProxyAgent } from './audio-proxy';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function proxyFixture(onConnect: (target: string, auth: string | undefined, socket: Socket) => void) {
  const sockets = new Set<Socket>(); const server = createServer();
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('connect', (request, socket) => onConnect(request.url!, request.headers['proxy-authorization'], socket as Socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://proxy-user:proxy-secret@127.0.0.1:${(server.address() as AddressInfo).port}`, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}
describe('audio HTTP CONNECT proxy', () => {
  it('tunnels to pinned public addresses through redirects and keeps proxy authentication out of origin requests', async () => {
    const targets: string[] = []; const auth: Array<string | undefined> = []; const requests: string[] = [];
    const proxy = await proxyFixture((target, authorization, socket) => {
      targets.push(target); auth.push(authorization); socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.once('data', (data) => {
        requests.push(data.toString());
        socket.end(targets.length === 1
          ? 'HTTP/1.1 302 Found\r\nLocation: http://cdn.example/file\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
          : 'HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndata');
      });
    });
    try {
      const stream = await openAudioStream('http://audio.example/file', undefined, 0, async (host) => [{ address: host === 'audio.example' ? '8.8.8.8' : '8.8.4.4', family: 4 }], {}, 4, proxy.url);
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe('data');
      expect(targets).toEqual(['8.8.8.8:80', '8.8.4.4:80']);
      expect(auth).toEqual(Array(2).fill(`Basic ${Buffer.from('proxy-user:proxy-secret').toString('base64')}`));
      expect(requests[0]).toContain('Host: audio.example'); expect(requests[1]).toContain('Host: cdn.example');
      expect(requests.join('\n')).not.toMatch(/proxy-authorization|proxy-user|proxy-secret/i);
    } finally { await proxy.close(); }
  });
  it.each([407, 502])('reports CONNECT %s without leaking credentials or the upstream reply', async (status) => {
    const before = runtimeLogSnapshot(); const after = before.entries.at(-1)?.sequence ?? 0;
    const proxy = await proxyFixture((_target, _auth, socket) => socket.end(`HTTP/1.1 ${status} proxy-secret\r\nContent-Length: 0\r\n\r\n`));
    try {
      await expect(openAudioStream('http://audio.example/file', undefined, 0, async () => [{ address: '8.8.8.8', family: 4 }], {}, 4, proxy.url)).rejects.toMatchObject({ code: status === 407 ? 'PROXY_AUTH_REQUIRED' : 'PROXY_UNAVAILABLE' });
      const output = JSON.stringify(runtimeLogSnapshot({ runId: before.runId, after }).entries);
      expect(output).not.toMatch(/proxy-user|proxy-secret|127\.0\.0\.1/);
    } finally { await proxy.close(); }
  });
  it('retains origin TLS verification while CONNECT uses the validated IP', async () => {
    const socket = { destroy: vi.fn() } as unknown as Socket;
    const connect = vi.spyOn(HttpsProxyAgent.prototype, 'connect').mockImplementation(async () => socket);
    const agent = audioProxyAgent('https://proxy-user:proxy-secret@proxy.example', '8.8.8.8', 'audio.example');
    agent.emit('proxyConnect', { statusCode: 200 });
    await agent.connect({ destroyed: false } as Parameters<typeof agent.connect>[0], { host: 'audio.example', port: 443, secureEndpoint: true });
    expect(connect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ host: '8.8.8.8', servername: 'audio.example', secureEndpoint: true }));
    expect(agent.proxy.href).toBe('https://proxy.example/'); expect(agent.connectOpts).not.toHaveProperty('rejectUnauthorized', false);
    agent.destroy();
  });
  it('closes a stalled CONNECT socket when playback is cancelled', async () => {
    const controller = new AbortController();
    const proxy = await proxyFixture(() => controller.abort());
    try {
      await expect(openAudioStream('http://audio.example/file', controller.signal, 0, async () => [{ address: '8.8.8.8', family: 4 }], {}, 4, proxy.url)).rejects.toBeInstanceOf(Error);
    } finally { await proxy.close(); }
  });
  it('aborts the pending proxy socket after the connection deadline and clears its timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(HttpsProxyAgent.prototype, 'connect').mockImplementation(async () => new Promise<Socket>((_resolve, reject) => {
      agent.connectOpts.signal!.addEventListener('abort', () => reject(new Error('proxy-secret')), { once: true });
    }));
    const agent = audioProxyAgent('http://proxy.example', '8.8.8.8', 'audio.example');
    const result = agent.connect({ destroyed: false } as Parameters<typeof agent.connect>[0], { host: 'audio.example', port: 80, secureEndpoint: false });
    const failed = expect(result).rejects.toMatchObject({ code: 'PROXY_UNAVAILABLE', message: expect.not.stringContaining('proxy-secret') });
    await vi.advanceTimersByTimeAsync(8000); await failed;
    expect(agent.connectOpts.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0); agent.destroy();
  });
});
