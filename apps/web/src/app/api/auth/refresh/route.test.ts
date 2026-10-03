import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server', () => ({ appUrl: () => new URL('https://scrt.example') }));
vi.mock('@/lib/session', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/session')>(), refreshSession: mocks.refreshSession }));
import { SessionRefreshUnavailableError } from '@/lib/session';
import { GET } from './route';

describe('OAuth refresh route', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns to the selected local page after refreshing', async () => {
    mocks.refreshSession.mockResolvedValue(true);
    const response = await GET(new NextRequest('https://scrt.example/api/auth/refresh?next=%2Fservers%2F123&force=1'));
    expect(response.headers.get('location')).toBe('https://scrt.example/servers/123');
    expect(mocks.refreshSession).toHaveBeenCalledWith(true);
  });
  it('returns to login for a revoked session', async () => {
    mocks.refreshSession.mockResolvedValue(false);
    const response = await GET(new NextRequest('https://scrt.example/api/auth/refresh'));
    expect(response.headers.get('location')).toBe('https://scrt.example/');
  });
  it('shows a noncached retry page for a temporary outage and preserves the safe destination', async () => {
    mocks.refreshSession.mockRejectedValue(new SessionRefreshUnavailableError());
    const response = await GET(new NextRequest('https://scrt.example/api/auth/refresh?next=%2Fservers%3Ftab%3Dvoice&force=1'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('retry-after')).toBe('5');
    const body = await response.text();
    expect(body).toContain('Вашу сесію збережено');
    expect(body).toContain('next=%2Fservers%3Ftab%3Dvoice&amp;force=1');
  });
  it('prevents external redirects in the retry link', async () => {
    mocks.refreshSession.mockRejectedValue(new SessionRefreshUnavailableError());
    const response = await GET(new NextRequest('https://scrt.example/api/auth/refresh?next=https%3A%2F%2Fattacker.example'));
    const body = await response.text();
    expect(body).not.toContain('attacker.example');
    expect(body).toContain('next=%2Fservers');
  });
});
