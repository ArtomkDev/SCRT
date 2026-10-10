export type LogContext = Record<string, string | number | boolean | null | undefined>;
export type RuntimeLogEntry = { sequence: number; time: string; level: 'info' | 'warn' | 'error'; module: string; action: string; message: string; context: LogContext; stack?: string };
export type RuntimeLogSnapshot = { runId: string; startedAt: string; dropped: number; entries: RuntimeLogEntry[] };
const capacity = 5000;
// Process-local only. A global slot also survives development module reloads.
const runtime = globalThis as typeof globalThis & { __scrtRuntimeLog?: { runId: string; startedAt: string; sequence: number; entries: RuntimeLogEntry[]; sizes: number[]; bytes: number } };
function buffer() {
  return runtime.__scrtRuntimeLog ??= { runId: globalThis.crypto.randomUUID(), startedAt: new Date(performance.timeOrigin).toISOString(), sequence: 0, entries: [], sizes: [], bytes: 0 };
}
export function redactLogText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|secret|password|authorization|cookie|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .slice(0, 4000);
}
export function runtimeLogSnapshot(cursor?: { runId: string; after: number }): RuntimeLogSnapshot {
  const state = buffer();
  const after = cursor?.runId === state.runId ? cursor.after : 0;
  const entries = cursor ? state.entries.filter((entry) => entry.sequence > after).slice(0, 500) : state.entries;
  return { runId: state.runId, startedAt: state.startedAt, dropped: state.sequence - state.entries.length, entries: entries.map((entry) => ({ ...entry, context: { ...entry.context } })) };
}
export function log(level: RuntimeLogEntry['level'], module: string, action: string, context: LogContext = {}, error?: unknown) {
  const safeContext = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined).slice(0, 30).map(([key, value]) => [key.slice(0, 100), /token|secret|password|authorization|cookie|key/i.test(key) ? '[REDACTED]' : typeof value === 'string' ? redactLogText(value) : typeof value === 'number' && !Number.isFinite(value) ? null : value]));
  const failure = error instanceof Error ? redactLogText(`${error.name}: ${error.message}${error.cause instanceof Error ? `; cause: ${error.cause.message}` : ''}`) : error === undefined ? '' : redactLogText(String(error));
  const message = redactLogText(`${module}/${action}${Object.keys(safeContext).length ? ` ${JSON.stringify(safeContext)}` : ''}${failure ? `: ${failure}` : ''}`);
  const state = buffer();
  const entry: RuntimeLogEntry = { sequence: ++state.sequence, time: new Date().toISOString(), level, module: redactLogText(module), action: redactLogText(action), message, context: safeContext, ...(error instanceof Error && error.stack ? { stack: redactLogText(error.stack) } : {}) };
  state.entries.push(entry);
  const size = JSON.stringify(entry).length * 2;
  state.sizes.push(size); state.bytes += size;
  while (state.entries.length > capacity || state.bytes > 8 * 1024 * 1024) { state.entries.shift(); state.bytes -= state.sizes.shift()!; }
  const line = JSON.stringify({ ...safeContext, ...entry });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
