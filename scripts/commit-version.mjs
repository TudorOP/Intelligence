import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { releaseLabel } from '../electron/release-version.mjs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')),
  lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const short = releaseLabel(pkg.version);
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version)
  throw Error('Version and lockfile disagree');
if (!fs.readFileSync('README.md', 'utf8').startsWith('# Intelligence ' + short))
  throw Error('Update release docs before committing');
execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: 'pipe' });
execFileSync('git', ['add', '.'], { stdio: 'inherit' });
const message = process.argv[2] || 'Release ' + short + ' — verified application update';
execFileSync('git', ['commit', '-m', message], { stdio: 'inherit' });
console.log(execFileSync('git', ['log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim());
