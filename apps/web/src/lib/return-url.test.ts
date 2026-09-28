import { describe, expect, it } from 'vitest';
import { safeReturnUrl } from './return-url';

const base = new URL('http://localhost:3000');
describe('post-refresh redirect', () => {
  it('keeps internal guild routes', () => expect(safeReturnUrl('/servers/12345678901234567', base).pathname).toBe('/servers/12345678901234567'));
  it('rejects protocol-relative and backslash redirects', () => {
    expect(safeReturnUrl('//evil.example', base).origin).toBe(base.origin);
    expect(safeReturnUrl('/\\evil.example', base).origin).toBe(base.origin);
  });
});
