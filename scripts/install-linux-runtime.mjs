import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.platform !== 'linux' || !fs.existsSync('/.dockerenv'))
  throw new Error('Install release native runtimes inside the Linux Docker build');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const packages = [
  '@node-llama-cpp/linux-x64',
  '@rolldown/binding-linux-x64-gnu',
  'lightningcss-linux-x64-gnu',
  '@img/sharp-linux-x64',
  '@img/sharp-libvips-linux-x64',
].map((name) => {
  const version = lock.packages['node_modules/' + name]?.version;
  if (!version) throw new Error('Missing locked native runtime: ' + name);
  return name + '@' + version;
});
const result = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    'install',
    '--no-save',
    '--package-lock=false',
    '--omit=optional',
    '--ignore-scripts',
    ...packages,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
// Exercise CSS minification now so a missing native binding fails before Vite runs.
const { transform } = await import('lightningcss');
transform({
  filename: 'runtime-check.css',
  code: Buffer.from('body { color: red; }'),
  minify: true,
});
// Load libvips through its native .node binding, not just its package metadata.
const { default: sharp } = await import('sharp');
await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
  .png()
  .toBuffer();
const { env: transformerEnv } = await import('@huggingface/transformers');
if (!transformerEnv) throw Error('Embedding runtime failed to load');
// Fail the Docker build if the shipped CPU binary cannot load; never compile on the end user's host.
const { getLlama } = await import('node-llama-cpp');
const llama = await getLlama({ gpu: false, build: 'never', skipDownload: true });
await llama.dispose();
