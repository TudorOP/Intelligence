import fs from 'node:fs';
import { createHash } from 'node:crypto';
const file = 'electron/module-catalog.json',
  catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
const repo = 'csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21',
  revision = '9a65b6ea94c311ca770c2bf895b30f456a22d703';
const response = await fetch(
  'https://huggingface.co/api/models/' + repo + '/tree/' + revision + '?recursive=true',
);
if (!response.ok) throw Error('Model metadata unavailable');
const tree = await response.json(),
  files = [];
for (const [remote, name] of [
  ['encoder-epoch-99-avg-1.int8.onnx', 'encoder-epoch-99-avg-1.int8.onnx'],
  ['decoder-epoch-99-avg-1.onnx', 'decoder-epoch-99-avg-1.onnx'],
  ['joiner-epoch-99-avg-1.int8.onnx', 'joiner-epoch-99-avg-1.int8.onnx'],
  ['tokens.txt', 'tokens.txt'],
  ['README.md', 'MODEL_CARD'],
]) {
  const item = tree.find((item) => item.path === remote);
  if (!item) throw Error('Missing artifact ' + remote);
  const url = 'https://huggingface.co/' + repo + '/resolve/' + revision + '/' + remote;
  let sha256 = item.lfs?.oid;
  if (!sha256) {
    const r = await fetch(url);
    if (!r.ok) throw Error('Metadata artifact unavailable');
    sha256 = createHash('sha256')
      .update(Buffer.from(await r.arrayBuffer()))
      .digest('hex');
  }
  files.push({ name, url, sha256, bytes: item.size });
}
const stt = catalog.modules.find((item) => item.id === 'stt');
stt.model.name = 'English Zipformer · Lightweight (20M)';
stt.models = [
  {
    id: 'zipformer-en-libri-giga',
    storageId: 'stt-larger',
    revision,
    license: 'Apache-2.0',
    source: 'https://huggingface.co/' + repo,
    name: 'English Zipformer · Larger (LibriSpeech + GigaSpeech)',
    language: 'en-US',
    files,
  },
];
fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
console.log(
  'Pinned larger streaming English model: ' +
    files.reduce((n, item) => n + item.bytes, 0) +
    ' bytes',
);
