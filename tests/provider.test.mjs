import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { completion, listModels } from '../electron/provider.mjs';
async function server(t, handler) {
  const s = createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  return 'http://127.0.0.1:' + s.address().port;
}
test('Ollama streaming preserves split UTF-8 chunks and tool argument objects', async (t) => {
  const endpoint = await server(t, (req, res) => {
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: 'local-test' }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const bytes = Buffer.from(
      JSON.stringify({ message: { content: 'Hello 🌿' } }) +
        '\n' +
        JSON.stringify({
          message: { tool_calls: [{ function: { name: 'read_item', arguments: { id: '123' } } }] },
        }) +
        '\n',
    );
    res.write(bytes.subarray(0, 35));
    res.end(bytes.subarray(35));
  });
  const settings = { provider: 'ollama', endpoint, model: 'local-test' };
  assert.deepEqual(await listModels(settings), ['local-test']);
  let streamed = '';
  const answer = await completion(
    settings,
    [],
    [],
    (d) => (streamed += d),
    new AbortController().signal,
  );
  assert.equal(streamed, 'Hello 🌿');
  assert.equal(answer.tool_calls[0].function.arguments, '{"id":"123"}');
});
test('LM Studio SSE joins fragmented tool calls and preserves final data without newline', async (t) => {
  const endpoint = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [
            {
              delta: {
                content: 'Hi',
                reasoning_content: 'Check the note.',
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'read_item', arguments: '{"id":' } },
                ],
              },
            },
          ],
        }) +
        '\n\n' +
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"n"}' } }] } }],
        }),
    );
  });
  const answer = await completion(
    { provider: 'lmstudio', endpoint, model: 'test' },
    [],
    [],
    () => {},
    new AbortController().signal,
  );
  assert.equal(answer.content, 'Hi');
  assert.equal(answer.reasoning_content, 'Check the note.');
  assert.equal(answer.tool_calls[0].function.arguments, '{"id":"n"}');
});
