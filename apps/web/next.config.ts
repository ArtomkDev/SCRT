import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';
import { webEnv } from '@scrt/config';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '../../.env' });
const config: NextConfig = {
  transpilePackages: ['@scrt/artwork', '@scrt/config', '@scrt/database', '@scrt/discord', '@scrt/permissions', '@scrt/shared', '@scrt/validation'],
  // Stream private dashboard responses without gzip framing or proxy buffering; assets still compress.
  async headers() {
    return [{ source: '/servers/:path*', headers: [
      { key: 'X-Accel-Buffering', value: 'no' },
      { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0, must-revalidate, no-transform' },
    ] }];
  },
  experimental: { staleTimes: { dynamic: 30, static: 30 }, serverActions: { bodySizeLimit: '5mb' } },
};
export default (phase: string): NextConfig => {
  if (phase === PHASE_PRODUCTION_SERVER) webEnv();
  return config;
};
