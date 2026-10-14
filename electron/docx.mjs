import { inflateRawSync } from 'node:zlib';
// Read only the bounded text-bearing XML parts. No archive paths are extracted to disk.
export function extractDocx(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (
    end < 0 ||
    end + 22 > bytes.length ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6)
  )
    throw Error('Invalid DOCX archive');
  const count = bytes.readUInt16LE(end + 10);
  if (!count || count > 2048) throw Error('DOCX has too many entries');
  let position = bytes.readUInt32LE(end + 16),
    expanded = 0;
  const parts = new Map();
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50)
      throw Error('Invalid DOCX directory');
    const nameLength = bytes.readUInt16LE(position + 28),
      extra = bytes.readUInt16LE(position + 30),
      comment = bytes.readUInt16LE(position + 32),
      size = bytes.readUInt32LE(position + 24),
      compressed = bytes.readUInt32LE(position + 20),
      method = bytes.readUInt16LE(position + 10),
      local = bytes.readUInt32LE(position + 42),
      name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    expanded += size;
    if (expanded > 50 * 1024 * 1024 || position + 46 + nameLength + extra + comment > end)
      throw Error('DOCX exceeds extraction limits');
    if (['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'].includes(name)) {
      if (
        parts.has(name) ||
        size > 8 * 1024 * 1024 ||
        bytes.readUInt16LE(position + 8) & 1 ||
        local + 30 > position ||
        bytes.readUInt32LE(local) !== 0x04034b50
      )
        throw Error('Unsupported DOCX text part');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > position || ![0, 8].includes(method))
        throw Error('Invalid DOCX compressed data');
      const raw = bytes.subarray(start, start + compressed),
        xml = method === 8 ? inflateRawSync(raw, { maxOutputLength: 8 * 1024 * 1024 }) : raw;
      if (xml.length !== size) throw Error('DOCX text size mismatch');
      parts.set(name, new TextDecoder('utf-8', { fatal: true }).decode(xml));
    }
    position += 46 + nameLength + extra + comment;
  }
  if (!parts.has('word/document.xml')) throw Error('DOCX body is missing');
  const decode = (s) =>
    s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, v) => {
      const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (entities[v]) return entities[v];
      const n = v.startsWith('#x') ? parseInt(v.slice(2), 16) : Number(v.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : '�';
    });
  let text = '';
  for (const xml of parts.values()) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('DOCX external entities are unsupported');
    for (const m of xml.matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:(p|tc)>/g,
    )) {
      text +=
        m[1] !== undefined
          ? decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
          : m[2] === 'tab' || m[3] === 'tc'
            ? '\t'
            : '\n';
      if (text.length > 1000000) throw Error('Document text exceeds one million characters');
    }
    text += '\n';
  }
  return text.trim();
}
