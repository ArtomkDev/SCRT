import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';
import { webEnv } from '@scrt/config';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '../../.env' });
const config: NextConfig = { transpilePackages: ['@scrt/config', '@scrt/database', '@scrt/discord', '@scrt/permissions', '@scrt/shared', '@scrt/validation'] };
export default (phase: string): NextConfig => {
  if (phase === PHASE_PRODUCTION_SERVER) webEnv();
  return config;
};
