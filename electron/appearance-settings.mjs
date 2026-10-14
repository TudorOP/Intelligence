import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const themeIds = [
  'ink',
  'day',
  'night',
  'summer',
  'autumn',
  'winter',
  'festive',
  'tech',
  'astral',
  'marble',
];
export function validateAppearanceSettings(value) {
  for (const [key, choices] of [['backgroundArtwork', ['theme', 'custom', ...themeIds]]])
    if (value[key] !== undefined && !choices.includes(value[key]))
      throw Error('Invalid background choice');
  for (const [key, minimum, maximum] of [
    ['backgroundOpacity', 0, 35],
    ['backgroundBlur', 0, 24],
  ])
    if (
      value[key] !== undefined &&
      (!Number.isInteger(value[key]) || value[key] < minimum || value[key] > maximum)
    )
      throw Error('Invalid background strength');
  if (
    value.backgroundImage !== undefined &&
    (typeof value.backgroundImage !== 'string' ||
      (value.backgroundImage &&
        !/^intelligence-media:\/\/asset\/[a-f0-9-]+\.webp$/i.test(value.backgroundImage)))
  )
    throw Error('Choose an imported background image');
}
export async function importBackgroundImage(source, directory) {
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > 20 * 1024 ** 2)
    throw Error('Please choose an image smaller than 20 MB');
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(source).toLowerCase()))
    throw Error('Choose a PNG, JPEG or WebP background');
  const { default: sharp } = await import('sharp');
  const name = randomUUID() + '.webp',
    destination = path.join(directory, 'assets', name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const bytes = await fs.readFile(source);
    if (bytes.length > 20 * 1024 ** 2) throw Error('Image size changed during import');
    await sharp(bytes, { limitInputPixels: 24_000_000, animated: false })
      .rotate()
      .resize(2560, 1440, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toFile(destination);
  } catch (e) {
    await fs.unlink(destination).catch(() => {});
    throw Error('This background image could not be decoded safely');
  }
  return 'intelligence-media://asset/' + name;
}
