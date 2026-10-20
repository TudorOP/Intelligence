import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPackage } from '@electron/asar';
import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';

const root = path.resolve('.'),
  directory = path.join(root, '.test-data', 'matrix-archive-' + Date.now());
const stage = path.join(directory, 'stage');
fs.mkdirSync(path.join(stage, 'electron'), { recursive: true });
fs.copyFileSync(
  'electron/matrix-file-worker.mjs',
  path.join(stage, 'electron', 'matrix-file-worker.mjs'),
);
fs.copyFileSync('electron/docx.mjs', path.join(stage, 'electron', 'docx.mjs'));
const copied = new Set();
function copyPackage(packagePath) {
  if (copied.has(packagePath)) return;
  copied.add(packagePath);
  const relative = path.relative(root, packagePath);
  if (relative.startsWith('..') || !relative.startsWith('node_modules'))
    throw new Error('Runtime dependency must be in the project');
  fs.cpSync(packagePath, path.join(stage, relative), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json')));
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    let cursor = packagePath,
      dependency;
    while (!dependency) {
      const candidate = path.join(cursor, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) dependency = candidate;
      else {
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error('Missing dependency: ' + name);
        cursor = parent;
      }
    }
    copyPackage(dependency);
  }
}
copyPackage(path.join(root, 'node_modules', 'pdf2json'));
// DOCX uses the existing native bounded ZIP/XML parser; Mammoth is no longer a runtime dependency.
copyPackage(path.join(root, 'node_modules', 'adm-zip'));
const archive = path.join(directory, 'parser.asar');
await createPackage(stage, archive);
const stream = 'BT /F1 12 Tf 20 100 Td (Archived PDF fixture) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.4\n',
  offsets = [];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf +=
  'xref\n0 6\n0000000000 65535 f \n' +
  offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
  `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const zip = new AdmZip();
zip.addFile(
  '[Content_Types].xml',
  Buffer.from(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
);
zip.addFile(
  '_rels/.rels',
  Buffer.from(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
);
zip.addFile(
  'word/document.xml',
  Buffer.from(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Archived DOCX fixture</w:t></w:r></w:p></w:body></w:document>',
  ),
);
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_DATA_DIR: path.join(directory, 'user-data'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.INTELLIGENCE_DEV_URL;
const desktop = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
  timeout: 30000,
});
try {
  for (const [extension, bytes, expected] of [
    ['.pdf', Buffer.from(pdf), 'Archived PDF fixture'],
    ['.docx', zip.toBuffer(), 'Archived DOCX fixture'],
  ]) {
    const result = await desktop.evaluate(
      async (_, input) => {
        const { Worker } = process.getBuiltinModule('worker_threads');
        return new Promise((resolve, reject) => {
          const worker = new Worker(new URL(input.path), {
            workerData: { extension: input.extension, bytes: Buffer.from(input.data, 'base64') },
          });
          const timer = setTimeout(() => {
            void worker.terminate();
            reject(new Error('Archived parser timed out'));
          }, 25000);
          worker.once('message', (result) => {
            clearTimeout(timer);
            void worker.terminate();
            result.error ? reject(new Error(result.error)) : resolve(result.text);
          });
          worker.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
      },
      {
        path: pathToFileURL(path.join(archive, 'electron', 'matrix-file-worker.mjs')).href,
        extension,
        data: bytes.toString('base64'),
      },
    );
    assert.ok(result.includes(expected));
  }
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: ['ASAR PDF parser and dependencies', 'ASAR DOCX parser and dependencies'],
      directory,
    }),
  );
} finally {
  await desktop.close();
}
