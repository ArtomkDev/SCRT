import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts', 'src/register-commands.ts', 'src/verify-media.ts'], format: 'esm', outDir: 'dist', splitting: false, noExternal: [/^@scrt\//], external: ['firebase-admin', 'discord.js', 'dotenv'], target: 'node22', clean: true });
