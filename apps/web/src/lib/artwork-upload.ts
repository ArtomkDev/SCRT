import 'server-only';
import sharp, { type Metadata } from 'sharp';

export const ARTWORK_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Decode actual bytes, limit pixels, remove metadata and never serve uploaded markup/animation. */
export async function prepareArtworkUpload(file: File, field: 'icon' | 'hero'): Promise<Buffer> {
  if (!file.size || file.size > ARTWORK_UPLOAD_LIMIT) throw new Error('Оберіть зображення до 4 МБ.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' });
  let metadata: Metadata;
  try { metadata = await image.metadata(); } catch { throw new Error('Файл не вдалося прочитати як зображення.'); }
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Оберіть статичне зображення PNG, JPEG або WebP.');
  const width = field === 'icon' ? 256 : 1600;
  const height = field === 'icon' ? 256 : 900;
  for (const quality of [82, 65, 45]) {
    const output = await image.clone().rotate().resize({ width, height, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
    if (output.length <= 400_000) return output;
  }
  throw new Error('Зображення надто складне. Зменшіть роздільність і спробуйте ще раз.');
}
