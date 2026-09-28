import { z } from 'zod';

const nonempty = z.string().min(1);
const firebase = { FIREBASE_PROJECT_ID: nonempty, FIREBASE_CLIENT_EMAIL: z.email(), FIREBASE_PRIVATE_KEY: nonempty };
const discord = { DISCORD_CLIENT_ID: nonempty, DISCORD_CLIENT_SECRET: nonempty };
const base = { NODE_ENV: z.enum(['development', 'test', 'production']).default('development') };
export const botEnvSchema = z.object({ ...base, ...firebase, DISCORD_BOT_TOKEN: nonempty, DISCORD_CLIENT_ID: nonempty, DISCORD_GUILD_ID: z.string().optional() });
export const webEnvSchema = z.object({ ...base, ...firebase, ...discord, NEXT_PUBLIC_APP_URL: z.url(), SESSION_SECRET: z.string().min(32), DISCORD_BOT_TOKEN: nonempty });

export function parseEnvironment<T extends z.ZodType>(schema: T, source: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new Error(`Invalid environment: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
}
export function botEnv() { return parseEnvironment(botEnvSchema, process.env); }
export function webEnv() { return parseEnvironment(webEnvSchema, process.env); }
