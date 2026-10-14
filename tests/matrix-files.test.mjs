import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Store } from '../electron/store.mjs';
import { MatrixFiles, matrixImageMessage } from '../electron/matrix-files.mjs';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-files-'));
  const store = new Store(directory),
    files = new MatrixFiles(store);
  const task = store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-core',
    title: 'Attachments',
    data: {},
  });
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const attach = async (name, data) => {
    const source = path.join(directory, name);
    fs.writeFileSync(source, data);
    return files.import(task.id, source);
  };
  return { store, files, task, attach };
}
function pdf(text) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n',
    offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}

test('Matrix attachments preserve full paginated UTF-8 and respect access and storage boundaries', async (t) => {
  const f = fixture(t),
    text = 'A'.repeat(14000) + '🌿 Last page';
  const file = await f.attach('context.txt', text);
  let offset = 0,
    combined = '';
  do {
    const page = await f.files.read(file.id, offset);
    combined += page.text;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(combined, text);
  f.store.setSettings({ matrixAccess: false });
  await assert.rejects(() => f.files.read(file.id), /outside current access/);
  assert.ok(await f.files.path(file.id, false));
  f.store.setSettings({ matrixAccess: true });
  assert.throws(
    () => f.store.mutate({ id: file.id, data: { storage: '../../secret.txt' } }),
    /immutable/,
  );
  f.store.db
    .prepare('UPDATE entities SET data=? WHERE id=?')
    .run(JSON.stringify({ storage: '../../secret.txt' }), file.id);
  await assert.rejects(() => f.files.path(file.id), /Invalid attachment path/);
});

test('PDF and DOCX are extracted in bounded workers and malformed/binary files return errors', async (t) => {
  const f = fixture(t);
  const pdfFile = await f.attach('context.pdf', pdf('Hello Matrix PDF'));
  assert.ok((await f.files.read(pdfFile.id)).text.includes('Hello Matrix PDF'));
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Matrix DOCX</w:t></w:r></w:p></w:body></w:document>',
    ),
  );
  const docxFile = await f.attach('context.docx', zip.toBuffer());
  assert.ok((await f.files.read(docxFile.id)).text.includes('Hello Matrix DOCX'));
  const binary = await f.attach('binary.bin', Buffer.from([0, 1, 2]));
  await assert.rejects(() => f.files.read(binary.id), /binary format/);
  const broken = await f.attach('broken.docx', Buffer.from('Invalid zip'));
  await assert.rejects(() => f.files.read(broken.id));
});

test('reports attach to tasks and permanent deletion removes only their managed files', async (t) => {
  const f = fixture(t),
    report = await f.files.report(f.task.id, '../answer.md', '# Verified report\nFixture answer');
  assert.equal(report.title, 'answer.md');
  assert.equal(report.data.generated, true);
  const managed = await f.files.path(report.id),
    bytes = fs.readFileSync(managed, 'utf8');
  assert.equal(bytes, '# Verified report\nFixture answer');
  assert.equal(path.dirname(managed), path.join(f.store.directory, 'matrix-files'));
  await assert.rejects(() => f.files.report(f.task.id, 'run.exe', 'Executable'), /filename/);
  f.store.mutate({ id: f.task.id, action: 'trash' });
  f.store.deleteTrash(f.task.id);
  assert.equal(fs.existsSync(managed), false);
});

test('image history reloads attachments without persisting base64 in messages', async (t) => {
  const f = fixture(t),
    image = await f.attach('image.png', Buffer.from('Image fixture'));
  const result = await f.files.read(image.id);
  assert.equal(result.imageAttachment, true);
  assert.ok(!JSON.stringify(result).includes('base64'));
  const wire = matrixImageMessage(f.store, image.id);
  assert.ok(wire.content[1].image_url.url.startsWith('data:image/png;base64,'));
  f.store.setSettings({ matrixAccess: false });
  assert.equal(typeof matrixImageMessage(f.store, image.id).content, 'string');
});
