import { Store } from '../electron/store.mjs';
import { Memory } from '../electron/memory.mjs';
import assert from 'node:assert/strict';
const store = new Store('.test-data/memory');
const memory = new Memory(store, (e) => {
  if (e.status?.includes('ready') || e.status?.startsWith('Downloading')) console.log(e.status);
});
try {
  const notebook = store.all().find((e) => e.kind === 'notebook' && e.data.access);
  const note = store.mutate({
    kind: 'note',
    parent: notebook.id,
    title: 'Audio repair',
    data: {
      content:
        'The microphone was muted in the audio settings. Unmuting the input device restored sound recording.',
    },
  });
  await memory.enable();
  const hits = await memory.search('Why was my voice not being recorded?');
  assert.ok(hits.some((e) => e.id === note.id));
  store.mutate({ id: note.id, data: { access: false } });
  const hidden = await memory.search('Why was my voice not being recorded?');
  assert.ok(!hidden.some((e) => e.id === note.id));
  console.log('CPU semantic retrieval and source revocation passed.');
  await memory.release();
  assert.equal(memory.pipeline, null);
  assert.equal(memory.embeddings.size, 0);
  console.log('CPU pipeline disposed after semantic search was released.');
} finally {
  await memory.close();
  store.close();
}
