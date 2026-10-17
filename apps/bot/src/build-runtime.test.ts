import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { build, type Options } from 'tsup';
import { expect, it } from 'vitest';
import config from '../tsup.config';

it('runs bundled CommonJS proxy dependencies inside the production ESM output', async () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'scrt-build-runtime-'));
  try {
    const mediaRequire = createRequire(new URL('../../../packages/media/package.json', import.meta.url));
    const proxyModule = mediaRequire.resolve('https-proxy-agent').replaceAll('\\', '/');
    const entry = join(directory, 'fixture.ts');
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(entry, `import { HttpsProxyAgent } from ${JSON.stringify(proxyModule)};\nconsole.log(new HttpsProxyAgent('http://proxy.example:8080').proxy.hostname);\n`);
    await build({ ...config as Options, entry: { runtime: entry }, outDir: directory, clean: false, silent: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LANG|LC_ALL)$/i.test(name)));
    const result = spawnSync(process.execPath, [join(directory, 'runtime.js')], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('proxy.example');
  } finally {
    // Only remove the temporary checkout created by this test, including on Windows.
    if (resolve(directory).startsWith(`${temporaryRoot}${sep}`) && basename(directory).startsWith('scrt-build-runtime-')) await rm(directory, { recursive: true, force: true });
  }
}, 20000);
