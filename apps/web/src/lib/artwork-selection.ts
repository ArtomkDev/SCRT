import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ArtworkAsset } from '@scrt/shared';
import { artworkAssetSchema, activityGameKeySchema, guildIdSchema } from '@scrt/validation';

const selectionSchema = z.object({ guildId: guildIdSchema, gameKey: activityGameKeySchema, field: z.enum(['icon', 'hero']), asset: artworkAssetSchema, expiresAt: z.number().int() });
export function signArtworkSelection(secret: string, guildId: string, gameKey: string, field: 'icon' | 'hero', asset: ArtworkAsset) {
  const payload = Buffer.from(JSON.stringify(selectionSchema.parse({ guildId, gameKey, field, asset, expiresAt: Date.now() + 30 * 60_000 }))).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function verifyArtworkSelection(secret: string, token: string, guildId: string, gameKey: string, field: 'icon' | 'hero'): ArtworkAsset {
  if (token.length > 50_000) throw new Error('Некоректний вибір зображення.');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('Некоректний вибір зображення.');
  const actual = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Некоректний вибір зображення.');
  const value = selectionSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  if (value.expiresAt <= Date.now() || value.guildId !== guildId || value.gameKey !== gameKey || value.field !== field) throw new Error('Вибір застарів. Відкрийте пошук знову.');
  return value.asset;
}
