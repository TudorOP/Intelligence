import { parentPort, workerData } from 'node:worker_threads';
import { extractDocx } from './docx.mjs';
try {
  // Own the ArrayBuffer: PDF parsers must not read a pooled Buffer's unrelated bytes.
  const bytes = Buffer.alloc(workerData.bytes.length);
  Buffer.from(workerData.bytes).copy(bytes);
  let text;
  if (workerData.extension === '.pdf') {
    const { default: PDFParser } = await import('pdf2json');
    text = await new Promise((resolve, reject) => {
      const parser = new PDFParser(null, 1);
      parser.once('pdfParser_dataError', (error) =>
        reject(new Error(String(error.parserError ?? error))),
      );
      parser.once('pdfParser_dataReady', () => {
        try {
          resolve(parser.getRawTextContent());
        } catch (error) {
          reject(error);
        } finally {
          parser.destroy();
        }
      });
      parser.parseBuffer(bytes);
    });
  } else if (workerData.extension === '.docx') {
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0 || end + 22 > bytes.length) throw new Error('Invalid DOCX archive');
    const count = bytes.readUInt16LE(end + 10);
    if (count > 2048) throw new Error('DOCX has too many entries; provide a smaller document');
    let position = bytes.readUInt32LE(end + 16),
      expanded = 0;
    for (let i = 0; i < count; i++) {
      if (position + 46 > bytes.length || bytes.readUInt32LE(position) !== 0x02014b50)
        throw new Error('Invalid DOCX directory');
      expanded += bytes.readUInt32LE(position + 24);
      if (expanded > 50 * 1024 * 1024)
        throw new Error('DOCX expands beyond 50 MB; provide a smaller document');
      position +=
        46 +
        bytes.readUInt16LE(position + 28) +
        bytes.readUInt16LE(position + 30) +
        bytes.readUInt16LE(position + 32);
    }
    text = extractDocx(bytes);
  } else {
    if (bytes.includes(0)) throw new Error('This binary format needs a text/PDF/DOCX export');
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('Provide a UTF-8 text, PDF, DOCX, or image attachment');
    }
  }
  if (text.length > 1000000)
    throw new Error('Document is too large to extract; split it into smaller files');
  if (!text.trim() && ['.pdf', '.docx'].includes(workerData.extension))
    throw new Error(
      'No readable text was found. Attach page images for a vision model or provide a text export.',
    );
  parentPort.postMessage({ text });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
