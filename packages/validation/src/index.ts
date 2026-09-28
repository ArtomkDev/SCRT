import { z } from 'zod';

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Expected a Discord snowflake');
export const guildIdSchema = snowflakeSchema;
export const discordUserSchema = z.object({ id: snowflakeSchema, username: z.string(), global_name: z.string().nullable().optional(), avatar: z.string().nullable().optional() });
export const discordGuildSchema = z.object({ id: guildIdSchema, name: z.string(), icon: z.string().nullable(), owner: z.boolean(), permissions: z.string() });

