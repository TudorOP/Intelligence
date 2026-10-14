import fs from 'node:fs/promises';
import sharp from 'sharp';
const inputs = process.argv.slice(2);
if (inputs.length !== 4) throw Error('Provide Festive, Tech, Astral and Marble background images');
for (const [i, theme] of ['festive', 'tech', 'astral', 'marble'].entries()) {
  await fs.copyFile(inputs[i], `public/assets/originals/background-detail-${theme}.png`);
  await sharp(inputs[i]).webp({ quality: 94 }).toFile(`public/assets/background-detail-${theme}.webp`);
}
