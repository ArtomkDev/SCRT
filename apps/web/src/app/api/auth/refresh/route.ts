import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@/lib/server';
import { refreshSession } from '@/lib/session';
import { safeReturnUrl } from '@/lib/return-url';

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next') ?? '/servers';
  const base = appUrl();
  const safe = safeReturnUrl(next, base);
  const valid = await refreshSession();
  return NextResponse.redirect(valid ? safe : new URL('/', base));
}
