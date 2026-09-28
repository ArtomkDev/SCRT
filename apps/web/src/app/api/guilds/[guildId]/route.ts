import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireGuildAccess } from '@/lib/guards';
import { accessToken } from '@/lib/session';

export async function GET(_request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await accessToken()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { guildId } = await context.params;
    const { guild, permissions } = await requireGuildAccess(guildId);
    return NextResponse.json({ guild, permissions: [...permissions] });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: 'Invalid guild ID' }, { status: 400 });
    if (error instanceof Error && error.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (error instanceof Error && error.message === 'Bot not installed') return NextResponse.json({ error: 'Bot not installed' }, { status: 409 });
    return NextResponse.json({ error: 'Guild unavailable' }, { status: 503 });
  }
}
