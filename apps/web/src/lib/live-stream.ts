import 'server-only';

type Subscribe = (emit: (kind: string) => void, fail: (error: Error) => void) => () => void;

export function liveStream(request: Request, subscribe: Subscribe, context: string, maxAgeMs = 4 * 60_000): Response {
  const encoder = new TextEncoder();
  let close: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};
      const send = (message: string) => {
        if (closed) return;
        const data = encoder.encode(message);
        // Disconnect a slow consumer before its queued events grow without bound.
        if ((controller.desiredSize ?? 0) < data.byteLength) { close(); return; }
        controller.enqueue(data);
      };
      const heartbeat = setInterval(() => send(': keepalive\n\n'), 25_000);
      const expiry = setTimeout(() => close(), maxAgeMs);
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(expiry);
        request.signal.removeEventListener('abort', close);
        unsubscribe();
        try { controller.close(); } catch { /* The browser has already closed the stream. */ }
      };
      request.signal.addEventListener('abort', close, { once: true });
      if (request.signal.aborted) { close(); return; }
      send(': connected\n\n');
      try {
        const stop = subscribe(
          (kind) => send(`event: ${kind === 'sync' ? 'sync' : 'change'}\ndata: ${kind}\n\n`),
          (error) => {
            console.error('Dashboard change stream failed', { context, error });
            send('event: fault\ndata: reconnect\n\n');
            close();
          },
        );
        if (closed) stop(); else unsubscribe = stop;
      } catch (error) {
        console.error('Dashboard change stream could not start', { context, error });
        close();
      }
    },
    cancel() { close(); },
  }, { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
