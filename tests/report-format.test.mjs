import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReport,
  reportView,
  markdownSections,
  fullReport,
} from '../electron/report-format.mjs';
const result = {
  summary: 'Today’s overview',
  sections: [
    { title: 'Your day', content: 'No events.' },
    { title: 'Science brief', content: '## Findings\n\n**Useful** [source](https://example.org).' },
    { title: 'Technology brief', content: 'A second brief with {braces} and "quotes".' },
  ],
};
test('wrapped JSON, Markdown fences and a saved raw report recover all chapters without transport text', () => {
  for (const text of [
    JSON.stringify(result),
    'I have both pieces.\n```json\n' + JSON.stringify(result) + '\n```\nReport complete.',
  ]) {
    assert.deepEqual(parseReport(text), result);
    const view = reportView({
      sections: [{ title: 'Report', content: text }],
      content: '## Report\n\n' + text,
    });
    assert.equal(view.sections.length, 3);
    assert.equal(view.summary, result.summary);
    assert.match(view.content, /## Technology brief/);
    assert.doesNotMatch(view.content, /"sections"|I have both pieces/);
  }
});
test('alternate records and agenda schema becomes readable prose', () => {
  const parsed = parseReport(
    JSON.stringify({
      summary: 'Summary',
      sections: [
        {
          title: 'Your day',
          type: 'calendar',
          request: 'internal',
          agenda: [],
          records: [],
          researchAllowed: false,
        },
        {
          title: 'Science',
          articles: [
            { title: 'Discovery', summary: 'Measured result', url: 'https://example.org' },
          ],
        },
      ],
    }),
  );
  assert.match(parsed.sections[1].content, /Discovery/);
  assert.doesNotMatch(parsed.sections[0].content, /researchAllowed|internal/);
});
test('plain Markdown chapters retain content and ignore code-block headings', () => {
  const rows = markdownSections(
    'Introduction\n## First\nOne\n```md\n## Code heading\n```\n## Second\nTwo',
  );
  assert.deepEqual(
    rows.map((v) => v.title),
    ['Introduction', 'First', 'Second'],
  );
  assert.match(rows[1].content, /Code heading/);
  assert.equal(parseReport('{"sections": ['), null);
  assert.equal(parseReport(JSON.stringify({ sections: [{ title: 'Empty' }] })), null);
  assert.equal(fullReport([{ title: 'First', content: '# First\n\nBody' }]), '## First\n\nBody');
});
