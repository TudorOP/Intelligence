import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Agent, nativeTools } from '../electron/agent.mjs';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-overview-'));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return store;
}
test('workspace overview discovers collections across projects without revealing excluded content', async (t) => {
  const store = fixture(t),
    agent = new Agent(store, {}, {}, () => {});
  const first = store.mutate({
    kind: 'project',
    title: 'Accessible project',
    data: { access: true, permission: 'read' },
  });
  const second = store.mutate({
    kind: 'project',
    title: 'Another project',
    data: { access: true },
  });
  store.mutate({ kind: 'project', title: 'Private project', data: { access: false } });
  store.mutate({ kind: 'notebook', title: 'Hidden notebook', data: { access: false } });
  store.mutate({ kind: 'board', title: 'Canvas board', data: { access: true } });
  const result = await agent.execute('workspace_overview', {}, { project: first });
  assert.equal(result.categories.find((c) => c.kind === 'project').count, 2);
  assert.ok(result.collections.some((c) => c.id === second.id));
  assert.ok(result.collections.some((c) => c.title === 'Canvas board'));
  assert.ok(!JSON.stringify(result).includes('Private project'));
  assert.ok(!JSON.stringify(result).includes('Hidden notebook'));
  assert.equal(result.collections.find((c) => c.id === first.id).editable, false);
  assert.match(result.note, /no accessible items/);
  assert.ok(nativeTools.some((tool) => tool.function.name === 'workspace_overview'));
  const readonly = await agent.execute('workspace_overview', {}, { readOnlyMachineSession: true });
  assert.ok(readonly.collections.every((item) => item.editable === false));
});
test('overview paginates complete collection inventories and suspended sections do not leak counts', async (t) => {
  const store = fixture(t),
    agent = new Agent(store, {}, {}, () => {});
  for (let i = 0; i < 65; i++)
    store.mutate({ kind: 'project', title: 'Project ' + i, data: { access: true } });
  const seen = new Set();
  let offset = 0;
  while (offset !== null) {
    const result = await agent.execute('workspace_overview', { offset }, {});
    for (const item of result.collections) seen.add(item.id);
    offset = result.nextOffset;
  }
  assert.equal([...seen].filter((id) => store.get(id).kind === 'project').length, 65);
  store.setSettings({ notebookAccess: false, matrixAccess: false });
  const result = await agent.execute('workspace_overview', {}, {});
  assert.equal(result.categories.find((c) => c.kind === 'notebook').count, 0);
  assert.equal(result.categories.find((c) => c.kind === 'matrix-list').count, 0);
});
test('legacy layout values normalize to Studio without changing content; Skills view persists', (t) => {
  const store = fixture(t),
    before = store.all();
  for (const layout of ['compact', 'reading', 'studio']) {
    store.setSettings({ layout });
    assert.equal(store.settings().layout, 'studio');
  }
  store.setSettings({ skillsView: 'list' });
  assert.equal(store.settings().skillsView, 'list');
  assert.deepEqual(store.all(), before);
  assert.throws(() => store.setSettings({ skillsView: 'other' }), /Invalid Skills/);
});
