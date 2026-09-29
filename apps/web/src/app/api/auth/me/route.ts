import { NextResponse } from 'next/server';
import { discordUser } from '@scrt/discord';
import { accessToken, sessionUser } from '@/lib/session';

export async function GET() {
  const token = await accessToken();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { const user = await sessionUser() ?? await discordUser(token); return NextResponse.json({ id: user.id, username: user.username, avatar: user.avatar }); }
  catch { return NextResponse.json({ error: 'Discord unavailable' }, { status: 502 }); }
}
