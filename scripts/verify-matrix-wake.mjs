import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../electron/store.mjs';
import { CognitionMatrix } from '../electron/matrix.mjs';

const directory = path.resolve('.test-data/matrix-wake-' + Date.now());
const projectDirectory = path.join(directory, 'project');
fs.mkdirSync(projectDirectory, { recursive: true });
const store = new Store(path.join(directory, 'data'));
store.setSettings({ model: 'fixture', semanticSearch: false, autoConsolidation: false });
let modelCalls = 0;
const agent = {
  active: new Map(),
  stop() {},
  async chat() {
    ++modelCalls;
  },
};
const matrix = new CognitionMatrix(store, agent, undefined, {
  residentModel: async () => 'fixture',
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const project = store.mutate({
    kind: 'project',
    title: 'Watch fixture',
    data: { directory: projectDirectory, access: true },
  });
  store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-core',
    title: 'Watch file changes',
    data: { trigger: { kind: 'file', source: project.id, path: '.' }, status: 'queued' },
  });
  store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-core',
    title: 'Tomorrow',
    data: {
      status: 'queued',
      schedule: { start: new Date(Date.now() + 86400000).toISOString(), repeat: 'none' },
    },
  });
  matrix.start();
  for (let i = 0; i < 30; i++) {
    store.mutate({ id: 'matrix-core', data: { integrated: true } });
    await pause(35);
    assert.equal(matrix.triggers.watchers.size, 1);
    store.mutate({ id: 'matrix-core', data: { integrated: false } });
    assert.equal(matrix.triggers.watchers.size, 0);
    await pause(35);
    assert.equal(matrix.timer, null);
  }
  global.gc?.();
  const before = process.memoryUsage();
  for (let i = 0; i < 30; i++) {
    store.mutate({ id: 'matrix-core', data: { integrated: true } });
    await pause(35);
    store.mutate({ id: 'matrix-core', data: { integrated: false } });
    await pause(35);
  }
  global.gc?.();
  const after = process.memoryUsage();
  assert.ok(
    after.heapUsed - before.heapUsed < 8 * 1024 * 1024,
    'Repeated watcher cleanup must not retain growing task histories',
  );
  store.mutate({ id: 'matrix-core', data: { integrated: true } });
  await pause(80);
  const cpu = process.cpuUsage(),
    start = performance.now();
  await pause(2000);
  const elapsed = performance.now() - start,
    used = process.cpuUsage(cpu);
  const idlePercent = (used.user + used.system) / (elapsed * 10);
  assert.ok(idlePercent < 10, 'Idle shared scheduler should not busy-poll');
  assert.equal(modelCalls, 0);
  assert.equal(matrix.triggers.pending.size, 0);
  const result = {
    result: 'passed',
    cycles: 60,
    modelCalls,
    idleCorePercent: idlePercent,
    idleWatchers: matrix.triggers.watchers.size,
    heapGrowthBytes: after.heapUsed - before.heapUsed,
    rssBytes: after.rss,
    gcAvailable: !!global.gc,
    note: 'Node scheduler/native-watcher measurement on this host; renderer and real Linux GPU residency need separate validation.',
  };
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  matrix.close();
  assert.equal(matrix.timer, null);
  assert.equal(matrix.triggers.watchers.size, 0);
  assert.equal(store.listenerCount('changed'), 0);
  store.close();
}
