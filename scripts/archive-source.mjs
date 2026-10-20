#!/usr/bin/env node
// Build the local source archive from audited tracked source only.
// Uses the host tar (native on Linux and Windows 10+) piped through Node's
// zlib for a deterministic Intelligence-source.tar.gz. Never archives a
// recursive copy of the working directory.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(workspace, 'Intelligence-source.tar.gz');
if (path.dirname(output) !== workspace) throw Error('Archive must stay inside the source workspace');

// 1. Audit the tracked source before archiving anything.
execFileSync(process.execPath, ['scripts/verify-source.mjs'], { cwd: workspace, stdio: 'inherit' });

// 2. Inventory tracked files through Git, the same basis as the audit.
const tracked = execFileSync('git', ['ls-files'], { cwd: workspace, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
if (tracked.length === 0) throw Error('Tracked source inventory unavailable');
const names = [...tracked].sort();
for (const relative of names) {
  const absolute = path.resolve(workspace, relative);
  if (!absolute.startsWith(workspace + path.sep) || !fs.existsSync(absolute)) {
    throw Error(`Tracked file missing or escaped workspace: ${relative}`);
  }
}

// 3. Create a deterministic tarball: sorted entries, fixed mtime/owner,
//    system tar for the tar format and Node zlib for the gzip stream.
const output$ = fs.createWriteStream(output);
const tar = spawn('tar', [
  '--format=gnu',
  '--sort=name',
  '--mtime=@0',
  '--owner=0',
  '--group=0',
  '--numeric-owner',
  '--no-recursion',
  '-C', workspace,
  '--files-from=-',
  '-cf', '-',
], { cwd: workspace, stdio: ['pipe', 'pipe', 'inherit'] });
const gzip = zlib.createGzip({ level: 9 });
tar.stdout.pipe(gzip).pipe(output$);
tar.stdin.end(names.join('\n') + '\n');
await new Promise((resolve, reject) => {
  output$.on('finish', resolve);
  output$.on('error', reject);
  tar.on('error', reject);
  tar.on('exit', (code) => code === 0 || reject(new Error(`tar exited with ${code}`)));
});

// 4. Read the archive back and enforce the required, retired and excluded sets.
const listing = execFileSync('tar', ['-tzf', output], { cwd: workspace, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const archived = new Set(listing);
const required = [
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', '.github/FUNDING.yml',
  '.github/workflows/source-checks.yml', 'scripts/verify-source.mjs',
  'scripts/archive-source.mjs', 'AGENTS.md', 'LICENSE', 'COPYRIGHT',
  'docs/AGENT_HANDOFF.md', 'docs/LINUX_HANDOFF.md', 'docs/APPEARANCE.md',
  'docs/VERIFICATION.md', 'docs/RELEASE_CHECKLIST.md', 'compose.yaml',
  'Dockerfile', 'package-lock.json', 'package.json',
  'electron/appearance-settings.mjs', 'electron/release-version.mjs',
  'electron/agent.mjs', 'src/AppBackground.tsx', 'src/theme-extensions.css',
  'scripts/verify-themes.mjs', 'tests/appearance.test.mjs',
  'tests/release-version.test.mjs', 'public/assets/theme-provenance.json',
  'public/licenses/GPL-3.0.txt', 'public/licenses/index.json',
  'public/licenses/kokoro/index.json',
];
for (const entry of required) if (!archived.has(entry)) throw Error(`Missing ${entry}`);
for (const theme of ['festive', 'tech', 'astral', 'marble']) {
  for (const entry of [
    `public/assets/theme-${theme}.webp`,
    `public/assets/welcome-${theme}.webp`,
    `public/assets/background-detail-${theme}.webp`,
    `public/assets/originals/background-detail-${theme}.png`,
    `public/assets/originals/theme-${theme}.png`,
    `public/assets/originals/welcome-${theme}.png`,
  ]) {
    if (!archived.has(entry)) throw Error(`Missing ${entry}`);
  }
}
if (archived.has('src/background-animation.ts') || archived.has('public/assets/hearth.png')) {
  throw Error('Retired animation resources must not ship');
}
const excluded =
  /^(node_modules|dist|release|\.git|\.cache|\.test-data|docs\/screenshots)\/|\.sqlite|\.env$|\.(gguf|onnx|bundle)$|private-history|docs\/(V[12]_|NEXT_|PERSONAL_)/;
for (const entry of listing) {
  if (excluded.test(entry)) throw Error(`Archive contains excluded data or internal development records: ${entry}`);
}

const version = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).version;
const bytes = fs.statSync(output).size;
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex').toUpperCase();
console.log(JSON.stringify({ Path: output, Version: version, Files: listing.length, Bytes: bytes, SHA256: sha256 }));
