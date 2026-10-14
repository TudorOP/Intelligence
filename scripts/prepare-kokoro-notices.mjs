import fs from 'node:fs';
const directory = 'public/licenses/kokoro';
const entries = JSON.parse(fs.readFileSync(directory + '/index.json', 'utf8')).filter(
  (entry) =>
    ![
      'ESPEAK-LOADER-MIT.txt',
      'ESPEAK-GPL-3.0.txt',
      'MODEL-APACHE-2.0.txt',
      'FLATBUFFERS-APACHE-2.0.txt',
      'MODEL-CARD.txt',
      'SOURCE-NOTICES.txt',
    ].includes(entry.file.split('/').at(-1)),
);
for (const [name, title, url] of [
  [
    'ESPEAK-LOADER-MIT.txt',
    'eSpeak NG loader · MIT',
    'https://raw.githubusercontent.com/thewh1teagle/espeakng-loader/main/LICENSE',
  ],
  [
    'ESPEAK-GPL-3.0.txt',
    'eSpeak NG · GPLv3',
    'https://raw.githubusercontent.com/espeak-ng/espeak-ng/1.52.0/COPYING',
  ],
  [
    'MODEL-APACHE-2.0.txt',
    'Kokoro-82M weights and voices · Apache 2.0',
    'https://www.apache.org/licenses/LICENSE-2.0.txt',
  ],
  [
    'FLATBUFFERS-APACHE-2.0.txt',
    'FlatBuffers · Apache 2.0',
    'https://www.apache.org/licenses/LICENSE-2.0.txt',
  ],
  [
    'MODEL-CARD.txt',
    'Kokoro-82M · model provenance and attribution',
    'https://huggingface.co/hexgrad/Kokoro-82M/raw/main/README.md',
  ],
]) {
  const r = await fetch(url);
  if (!r.ok) throw Error(url + ' ' + r.status);
  const bytes = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(directory + '/' + name, bytes);
  entries.push({ id: 'kokoro-' + name, title, file: 'kokoro/' + name });
}
const note = `Intelligence Kokoro adapter - October 12, 2026

Model: hexgrad/Kokoro-82M v1.0 (82 million parameters), Apache-2.0.
ONNX conversion and raw numeric Heart/Bella/Michael voice data:
https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
Revision: 1939ad2a8e416c0acfeecc08a694d14ef25f2231
Runtime: kokoro-onnx 0.6.1, MIT; https://github.com/thewh1teagle/kokoro-onnx
Phonemizer 3.4.0 / eSpeak NG: GPLv3 family; preserve their notices.
Loader 0.2.4: MIT wrapper; native library/dictionary terms remain separate.
Native eSpeak NG upstream: https://github.com/espeak-ng/espeak-ng
Wrapper upstream: https://github.com/thewh1teagle/espeakng-loader

Only the three named English voices are downloaded; no voice cloning.
The adapter repacks the verified raw float32 voice arrays into a temporary
numeric NPZ while loading. Values are not changed; no pickle/object data is used.
Model weights, engines and native dictionaries are downloaded into user data;
none are packaged in the Intelligence AppImage or source ZIP.

Exact source revision/build provenance of the espeakng-loader wheel's native
library and its dictionary constituents must be checked before public
redistribution; its wheel omits license/source files. Retained upstream license
text and source links do not replace the required matching corresponding source.
This update does not complete the existing public-distribution audit.
`;
fs.writeFileSync(directory + '/SOURCE-NOTICES.txt', note);
entries.push({
  id: 'kokoro-source',
  title: 'Kokoro module · sources, voice conversion and release audit',
  file: 'kokoro/SOURCE-NOTICES.txt',
});
fs.writeFileSync(directory + '/index.json', JSON.stringify(entries, null, 2) + '\n');
console.log('Retained ' + entries.length + ' Kokoro dependency/model notice records.');
