export type GuildRecord = {
  guildId: string;
  name: string;
  icon: string | null;
  ownerId: string;
  botInstalled: boolean;
  resourceRevision?: number;
  schemaVersion: 1;
};

export type LogContext = Record<string, string | number | boolean | null | undefined>;
export function log(level: 'info' | 'warn' | 'error', module: string, action: string, context: LogContext = {}, error?: unknown) {
  const failure = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error === undefined ? {} : { message: String(error) };
  const entry = { time: new Date().toISOString(), level, module, action, ...context, ...failure };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
