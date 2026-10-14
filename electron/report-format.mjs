// Model output is data. Recover the report envelope without rendering its transport JSON.
export function parseReport(text) {
  text = String(text || '').slice(0, 700000);
  let start = -1,
    depth = 0,
    quoted = false,
    escaped = false;
  const candidates = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (depth && quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (depth && c === '"') quoted = true;
    else if (c === '{') {
      if (!depth) start = i;
      depth++;
    } else if (c === '}' && depth && !--depth) {
      try {
        const value = JSON.parse(text.slice(start, i + 1));
        if (Array.isArray(value.sections) && value.sections.length <= 12) candidates.push(value);
      } catch {}
    }
  }
  const parsed = candidates.at(-1);
  if (!parsed) return null;
  const sections = parsed.sections
    .filter((v) => v && typeof v.title === 'string')
    .map((v) => ({ title: v.title.slice(0, 150), content: sectionText(v).slice(0, 200000) }));
  if (!sections.length || sections.some((v) => !v.content.trim())) return null;
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 5000) : '',
    sections,
  };
}
function sectionText(value) {
  if (typeof value.content === 'string') return value.content;
  const ignored = new Set([
    'title',
    'type',
    'request',
    'prompt',
    'researchAllowed',
    'sources',
    'enabled',
  ]);
  return Object.entries(value)
    .filter(([key]) => !ignored.has(key))
    .map(([key, value]) => {
      const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
      return '### ' + label[0].toUpperCase() + label.slice(1) + '\n\n' + readable(value);
    })
    .join('\n\n');
}
function readable(value, depth = 0) {
  if (depth > 8) return '';
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value))
    return value.length
      ? value
          .slice(0, 200)
          .map((v) => readable(v, depth + 1))
          .join('\n\n')
      : '—';
  if (typeof value === 'object')
    return Object.entries(value)
      .slice(0, 40)
      .map(([k, v]) => '**' + k + ':** ' + readable(v, depth + 1))
      .join('\n\n');
  return String(value);
}
export function reportView(data = {}) {
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const recovered =
    parseReport(data.content) || (sections.length === 1 ? parseReport(sections[0]?.content) : null);
  if (recovered) return { ...recovered, content: fullReport(recovered.sections) };
  let rows = sections.filter(
    (v) => v && typeof v.title === 'string' && typeof v.content === 'string',
  );
  if (rows.length === 1 && rows[0].title === 'Report') rows = markdownSections(rows[0].content);
  if (!rows.length && data.content) rows = markdownSections(String(data.content));
  return {
    summary: String(data.summary || ''),
    sections: rows,
    content: rows.length ? fullReport(rows) : String(data.content || ''),
  };
}
export function markdownSections(text) {
  const rows = [],
    lines = text.split('\n');
  let fenced = false,
    row = null,
    intro = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      row = { title: heading[1].slice(0, 150), content: '' };
      rows.push(row);
    } else if (row) row.content += line + '\n';
    else intro.push(line);
  }
  if (!rows.length) return [{ title: 'Report', content: text }];
  if (intro.join('\n').trim())
    rows.unshift({ title: 'Introduction', content: intro.join('\n').trim() });
  return rows;
}
export function fullReport(sections) {
  return sections
    .map((v) => {
      const content = v.content.replace(/^\s{0,3}#{1,6}\s+([^\n]+)\n+/, (match, title) =>
        title.trim() === v.title.trim() ? '' : match,
      );
      return '## ' + v.title.replaceAll('\n', ' ') + '\n\n' + content;
    })
    .join('\n\n');
}
