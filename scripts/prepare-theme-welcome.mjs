import fs from 'node:fs/promises';
import sharp from 'sharp';
const inputs = process.argv.slice(2);
if (inputs.length !== 4) throw Error('Provide Festive, Tech, Astral and Marble welcome images');
for (const [i, theme] of ['festive', 'tech', 'astral', 'marble'].entries()) {
  await fs.copyFile(inputs[i], `public/assets/originals/welcome-${theme}.png`);
  await sharp(inputs[i]).webp({ quality: 92 }).toFile(`public/assets/welcome-${theme}.webp`);
}
