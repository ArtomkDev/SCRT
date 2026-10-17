import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/register-commands.ts', 'src/verify-media.ts'],
  format: 'esm', outDir: 'dist', splitting: false,
  noExternal: [/^@scrt\//], external: ['firebase-admin', 'discord.js', 'dotenv'],
  // Bundled CommonJS dependencies need Node's require to load built-in modules.
  banner: { js: "import { createRequire as __scrtCreateRequire } from 'node:module';\nconst require = __scrtCreateRequire(import.meta.url);" },
  target: 'node22', clean: true,
});
