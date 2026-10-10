import { z } from 'zod';
export const runtimeLogCursorSchema = z.object({ runId: z.string().max(100).default(''), after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) });
export const runtimeLogSnapshotSchema = z.object({
  runId: z.string().max(100), startedAt: z.string().max(40), dropped: z.number().int().nonnegative(),
  entries: z.array(z.object({
    sequence: z.number().int().positive(), time: z.string().max(40), level: z.enum(['info', 'warn', 'error']),
    module: z.string().max(4000), action: z.string().max(4000), message: z.string().max(4000), stack: z.string().max(4000).optional(),
    context: z.record(z.string(), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])),
  })).max(5000),
});
export const runtimeLogResponseSchema = z.object({ web: runtimeLogSnapshotSchema, bot: runtimeLogSnapshotSchema.nullable(), botError: z.string().nullable() });
export type RuntimeLogResponse = z.infer<typeof runtimeLogResponseSchema>;
