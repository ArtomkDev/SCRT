import { z } from 'zod';
import { directoryMemberSchema, type DirectoryMember } from '@scrt/validation';

const messageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), revision: z.number().int().nonnegative(), members: z.array(directoryMemberSchema) }),
  z.object({ kind: z.literal('done'), revision: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('error'), error: z.enum(['intent', 'unavailable']) }),
]);

export async function readMemberSnapshot(response: Response, onPage: (members: DirectoryMember[]) => void): Promise<{ startRevision: number; endRevision: number }> {
  if (!response.ok) throw new Error(response.status === 409 ? 'intent' : 'unavailable');
  if (!response.body) throw new Error('Member snapshot stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let startRevision: number | null = null;
  let endRevision: number | null = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        const message = messageSchema.parse(JSON.parse(line));
        if (message.kind === 'error') throw new Error(message.error);
        if (message.kind === 'page') {
          startRevision ??= message.revision;
          onPage(message.members);
        } else endRevision = message.revision;
      }
      if (done) break;
    }
  } finally {
    if (endRevision === null) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (endRevision === null || buffer.trim()) throw new Error('Incomplete member snapshot');
  return { startRevision: startRevision ?? endRevision, endRevision };
}
