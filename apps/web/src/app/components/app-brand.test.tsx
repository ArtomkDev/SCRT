import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppBrand, AppMark } from './app-brand';

vi.stubGlobal('React', React);
vi.mock('server-only', () => ({}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('server-determined environment branding', () => {
  it.each(['development', 'production', 'test'])('uses NODE_ENV=%s as the source of truth', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    const { isDevelopment } = await import('@/lib/application-environment');
    const html = renderToStaticMarkup(<><AppBrand development={isDevelopment} /><AppMark development={isDevelopment} /></>);
    expect(html).toContain('SCRT');
    expect(html).toContain('CONTROL');
    expect(html.includes('>DEV<')).toBe(environment === 'development');
    expect(html.includes('app-mark-dev')).toBe(environment === 'development');
  });
});
