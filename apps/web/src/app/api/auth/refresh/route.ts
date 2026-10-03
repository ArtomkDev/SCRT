import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@/lib/server';
import { refreshSession, SessionRefreshUnavailableError } from '@/lib/session';
import { safeReturnUrl } from '@/lib/return-url';

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next') ?? '/servers';
  const base = appUrl();
  const safe = safeReturnUrl(next, base);
  try {
    const valid = await refreshSession(request.nextUrl.searchParams.get('force') === '1');
    return NextResponse.redirect(valid ? safe : new URL('/', base));
  } catch (error) {
    if (!(error instanceof SessionRefreshUnavailableError)) throw error;
    const retry = new URL('/api/auth/refresh', base);
    retry.searchParams.set('next', safe.pathname + safe.search + safe.hash);
    if (request.nextUrl.searchParams.get('force') === '1') retry.searchParams.set('force', '1');
    const href = retry.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    return new Response(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Оновлення входу — SCRT</title><style>body{margin:0;padding:24px;background:#202225;color:#f5f5f5;font:16px/1.6 system-ui}main{max-width:600px;margin:15vh auto}a{color:#aebcff}</style></head><body><main><h1>Не вдалося оновити вхід</h1><p>Discord тимчасово недоступний. Вашу сесію збережено.</p><a href="${href}">Спробувати ще раз</a></main></body></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Retry-After': '5' } });
  }
}
