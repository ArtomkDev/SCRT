import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));

import { AuthScreen } from './auth-screen';

describe('SCRT authentication composition', () => {
  it('keeps one primary login action, decorative artwork and production branding', () => {
    const html = renderToStaticMarkup(<AuthScreen development={false} />);
    expect(html.match(/href="\/api\/auth\/login"/gu)).toHaveLength(1);
    expect(html).toContain('<h1 id="auth-heading">Увійти до SCRT</h1>');
    expect(html).toContain('class="auth-visual" aria-hidden="true"');
    expect(html).toContain('alt=""');
    expect(html).toContain('class="auth-face-svg"');
    expect(html).toContain('class="auth-environment" aria-hidden="true"');
    expect(html).not.toContain('scrt-face.png');
    expect(html).not.toContain('>DEV<');
    expect(html).not.toContain('role="alert"');
  });
  it('reuses the development brand badge', () => {
    expect(renderToStaticMarkup(<AuthScreen development />)).toContain('>DEV<');
  });
  it.each(['oauth_state', 'oauth_failed'])('shows a compact retry state for %s', (error) => {
    const html = renderToStaticMarkup(<AuthScreen development={false} error={error} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Спробувати ще раз через Discord');
    expect(html).not.toContain(error);
  });
  it('treats a cancelled login as a status message', () => {
    const html = renderToStaticMarkup(<AuthScreen development={false} error="oauth_denied" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Вхід через Discord скасовано');
  });
  it.each(['<script>secret upstream exception</script>', 'constructor', 'toString', ['oauth_failed']])('ignores unrecognized or ambiguous query input', (error) => {
    const html = renderToStaticMarkup(<AuthScreen development={false} error={error} />);
    expect(html).not.toContain('secret');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('Увійти через Discord');
  });
});
