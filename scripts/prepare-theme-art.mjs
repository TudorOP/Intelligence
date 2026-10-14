import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const inputs = process.argv.slice(2);
if (inputs.length !== 4) throw Error('Provide Festive, Tech, Astral and Marble atlas files');
for (const [i, theme] of ['festive', 'tech', 'astral', 'marble'].entries()) {
  const input = inputs[i], metadata = await sharp(input).metadata();
  const size = Math.floor(Math.min(metadata.width, metadata.height) / 3);
  await fs.mkdir('public/assets/originals', { recursive: true });
  await fs.copyFile(input, `public/assets/originals/theme-${theme}.png`);
  await sharp(input).webp({ quality: 92 }).toFile(`public/assets/theme-${theme}.webp`);
  for (let category = 0; category < 9; category++) {
    const tile = sharp(input).extract({ left: (category % 3) * size, top: Math.floor(category / 3) * size, width: size, height: size });
    await tile.clone().webp({ quality: 92 }).toFile(`public/assets/banner-${theme}-${category}.webp`);
    if (category === 8) await tile.clone().webp({ quality: 88 }).toFile(`public/assets/background-${theme}.webp`);
  }
  console.log(JSON.stringify({ theme, width: metadata.width, height: metadata.height, tile: size }));
}
