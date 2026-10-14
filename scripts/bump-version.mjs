import fs from 'node:fs';
import { nextRelease, releaseLabel } from '../electron/release-version.mjs';
const pkg = JSON.parse(fs.readFileSync('package.json')),
  lock = JSON.parse(fs.readFileSync('package-lock.json'));
let next;
if (process.argv[2] === '--set') {
  const match = /^(\d+)\.(\d)(\d)?$/.exec(process.argv[3] || '');
  if (!match) throw Error('Provide a release label such as 0.9 or 0.91');
  next = `${Number(match[1])}.${Number(match[2])}.${Number(match[3] || 0)}`;
} else {
  if (process.argv[2] && !['step', 'hundredth'].includes(process.argv[2]))
    throw Error('Use step, or --set with an explicit release label');
  next = nextRelease(pkg.version);
}
pkg.version = next;
lock.version = next;
lock.packages[''].version = next;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
console.log(
  `Release ${releaseLabel(next)}; package ${next}. Refresh release docs, archive and verification before committing.`,
);
