import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Pin official standalone builds, including yt-dlp-ejs, for reproducible bot deployments.
const version = '2026.09.27.232945';
const builds = {
  'win32-x64': ['yt-dlp.exe', '997c00e8f8ed91431b1ddaeeae519743602beb0b6df0903194a2632e57df1b31'],
  'linux-x64': ['yt-dlp_linux', 'c862f694f81a8977e74946a08ad3ab6285104882061e4e46da9f754bda09db4e'],
  'linux-arm64': ['yt-dlp_linux_aarch64', '627d474b8a0ffe896f3879ee84a5f3df07ebae0f1ea5b93e244ee66132564d30'],
  'darwin-x64': ['yt-dlp_macos', '1b1a6420f23af38b4eff225d77e3839d0f5630e1e3a3e913bd29818d70b252df'],
  'darwin-arm64': ['yt-dlp_macos', '1b1a6420f23af38b4eff225d77e3839d0f5630e1e3a3e913bd29818d70b252df'],
};
const build = builds[`${process.platform}-${process.arch}`];
if (!build) throw new Error(`Unsupported Media extractor platform: ${process.platform}-${process.arch}`);
const [asset, expectedHash] = build;
const directory = fileURLToPath(new URL('../apps/bot/.media-tools/', import.meta.url));
const target = join(directory, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const installed = await readFile(target).catch(() => null);
if (!installed || hash(installed) !== expectedHash) {
  console.log(`Installing Media extractor ${version} (${asset})…`);
  const response = await fetch(`https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/${asset}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Media extractor download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== expectedHash) throw new Error('Media extractor checksum mismatch');
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o755 });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
if (process.platform !== 'win32') await chmod(target, 0o755);
