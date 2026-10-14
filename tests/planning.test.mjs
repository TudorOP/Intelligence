import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { Planning, planningInstruction, planningTools } from '../electron/planning.mjs';
import { ensureProfiles, mergePreferences, profileSettings } from '../electron/profiles.mjs';
import { wallToUTC, occurrences, nextTiming } from '../electron/calendar-time.mjs';
import { extractDocx } from '../electron/docx.mjs';
import { Agent } from '../electron/agent.mjs';
import { exportBackup, restoreBackup } from '../electron/backup.mjs';
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-planning-')),
    store = new Store(directory);
  store.setSettings({ model: 'fixture', semanticSearch: false, autoConsolidation: false });
  ensureProfiles(store);
  const agent = {
    active: new Map(),
    connections: { registry: new Map() },
    stops: [],
    stop(id) {
      this.stops.push(id);
    },
    async chat({ conversation }) {
      store.message(
        conversation,
        'assistant',
        JSON.stringify({
          summary: 'Verified summary',
          sections: [{ title: 'Your day', content: '## Actual findings\n\nNothing invented.' }],
        }),
      );
    },
  };
  const planning = new Planning(store, agent),
    workspace = new Workspace(store, {});
  workspace.planning = planning;
  t.after(() => {
    planning.close();
    workspace.close();
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, planning, workspace, agent };
}
const timing = (start = '2026-10-10T09:00', extra = {}) => ({
  start,
  timezone: 'Europe/Bucharest',
  repeat: 'none',
  ...extra,
});
test('task report handles tasks without runs and missing conversations without a null dereference', async (t) => {
  const { store, planning } = setup(t);
  const list = store.all().find((e) => e.kind === 'list');
  const task = store.mutate({ kind: 'card', parent: list.id, title: 'Not started', data: {} });
  const empty = await planning.action({ action: 'task-report', id: task.id });
  assert.equal(empty.content, '');
  assert.equal(empty.full, false);
  assert.equal(empty.conversation, undefined);
  store.mutate({
    id: task.id,
    data: { result: 'Saved summary', conversation: 'missing-conversation' },
  });
  const summary = await planning.action({ action: 'task-report', id: task.id });
  assert.equal(summary.content, 'Saved summary');
  assert.equal(summary.full, false);
  const matrix = store.all().find((e) => e.kind === 'matrix-list');
  const mt = store.mutate({ kind: 'matrix-task', parent: matrix.id, title: 'Queued', data: {} });
  assert.equal((await planning.action({ action: 'task-report', id: mt.id })).content, '');
});
test('planning backup preserves evidence and restores schedules paused for explicit review', async (t) => {
  const { store, planning } = setup(t);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-planning-backup-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const calendar = store.all().find((e) => e.kind === 'calendar');
  const event = await planning.action({
    action: 'calendar-save',
    calendarId: calendar.id,
    title: 'Keep event',
    data: { timing: timing(), endLocal: '2026-10-10T10:00', owner: 'user' },
  });
  const template = await planning.action({
    action: 'reports-save',
    title: 'Restored schedule',
    data: {
      enabled: true,
      access: true,
      agentProfile: store.settings().activeAgent,
      timing: timing(),
      sections: [{ type: 'custom', title: 'Briefing', sources: [] }],
    },
  });
  store.mutate({ id: template.id, data: { manualRequested: new Date().toISOString() } });
  const ledger = planning.startExecution('fixture-conversation', profileSettings(store));
  planning.endExecution(ledger, 'done');
  const exported = await exportBackup(store, destination);
  store.mutate({ id: event.id, title: 'Changed' });
  await restoreBackup(store, exported.directory);
  assert.equal(store.get(event.id).title, 'Keep event');
  assert.equal(store.get(template.id).data.enabled, false);
  assert.equal(store.get(template.id).data.manualRequested, null);
  assert.match(store.get(template.id).data.attention, /review/);
  assert.equal(store.settings().backgroundPaused, true);
  assert.equal(
    store.db.prepare('SELECT status FROM execution_ledger WHERE id=?').get(ledger).status,
    'done',
  );
});
test('wall times handle DST ambiguity/gaps, invalid dates and timezone offsets', () => {
  assert.equal(wallToUTC('2026-10-10T09:00', 'Europe/Bucharest'), '2026-10-10T06:00:00.000Z');
  assert.throws(() => wallToUTC('2026-03-08T02:30', 'America/New_York'), /does not exist/);
  assert.equal(
    Date.parse(wallToUTC('2026-11-01T01:30', 'America/New_York', 'later')) -
      Date.parse(wallToUTC('2026-11-01T01:30', 'America/New_York', 'earlier')),
    3600000,
  );
  assert.throws(() => wallToUTC('2026-02-30T09:00'), /Invalid/);
});
test('recurrence clamps monthly dates, handles custom dates/intervals/end dates and bounded ranges', () => {
  const values = occurrences(
    timing('2026-01-31T09:00', { repeat: 'monthly' }),
    '2026-01-01',
    '2026-04-01',
  );
  assert.equal(values.length, 3);
  assert.ok(values[1].startsWith('2026-02-28'));
  assert.equal(
    occurrences(
      timing('2026-10-10T09:00', { repeat: 'daily', interval: 3, until: '2026-10-20' }),
      '2026-10-01',
      '2026-11-01',
    ).length,
    4,
  );
  assert.equal(
    occurrences(
      timing('', { repeat: 'dates', dates: ['2026-10-12T08:00', '2026-10-14T18:00'] }),
      '2026-10-01',
      '2026-11-01',
    ).length,
    2,
  );
  assert.throws(() => occurrences(timing(), '2026-01-01', '2028-01-01'), /range/);
  assert.equal(nextTiming(timing(), Date.parse('2026-10-11')), null);
});
test('event CRUD validates revisions, time bounds, series exceptions, native grants and ownership', async (t) => {
  const { store, planning } = setup(t),
    calendar = store.all().find((e) => e.kind === 'calendar');
  const e = await planning.action({
    action: 'calendar-save',
    title: 'Appointment',
    calendarId: calendar.id,
    data: { timing: timing(), endLocal: '2026-10-10T10:00', owner: 'user' },
  });
  assert.equal(e.data.duration, 3600000);
  assert.equal(store.access(e.id), false);
  await assert.rejects(
    planning.action({
      action: 'calendar-save',
      id: e.id,
      revision: e.revision - 1,
      data: { ...e.data, description: 'stale' },
    }),
    /changed/,
  );
  await assert.rejects(
    planning.action({
      action: 'calendar-save',
      title: 'Bad',
      calendarId: calendar.id,
      data: { timing: timing(), endLocal: '2026-10-10T08:00' },
    }),
    /end/,
  );
  store.mutate({ id: calendar.id, data: { access: true, permission: 'read' } });
  const ctx = {
    profileSettings: profileSettings(store),
    conversation: store.mutate({ kind: 'conversation', title: 'Calendar chat' }).id,
  };
  await assert.rejects(
    planning.action(
      {
        action: 'calendar-save',
        id: e.id,
        revision: e.revision,
        data: { ...e.data, description: 'agent' },
      },
      ctx,
    ),
    /edit access/,
  );
});
test('Calendar excludes chat turns, keeps task execution and survives history cleanup', async (t) => {
  const { store, planning, workspace } = setup(t),
    calendar = store.all().find((e) => e.kind === 'calendar');
  await planning.action({
    action: 'calendar-save',
    title: 'My appointment',
    calendarId: calendar.id,
    data: { timing: timing(), endLocal: '2026-10-10T10:00' },
  });
  await planning.action({
    action: 'calendar-save',
    title: 'Agent appointment',
    calendarId: calendar.id,
    data: {
      timing: timing(),
      endLocal: '2026-10-10T10:00',
      owner: 'agent',
      agentProfile: store.settings().activeAgent,
    },
  });
  const list = store.all().find((e) => e.kind === 'list'),
    task = store.mutate({ kind: 'card', parent: list.id, title: 'Agent task', data: {} }),
    c = store.mutate({ kind: 'conversation', title: 'Agent work' }),
    id = planning.startExecution(c.id, profileSettings(store), task.id),
    chat = store.mutate({ kind: 'conversation', title: 'Ordinary chat' }),
    chatTurns = [
      planning.startExecution(chat.id, profileSettings(store)),
      planning.startExecution(chat.id, profileSettings(store)),
    ];
  planning.endExecution(id, 'done');
  chatTurns.forEach((turn) => planning.endExecution(turn, 'done'));
  const span = { from: '2026-01-01', to: '2026-12-31' };
  const personal = planning.range({ ...span, mode: 'personal' }).items,
    combined = planning.range({ ...span, mode: 'combined' }).items,
    agent = planning.range({ ...span, mode: 'agent' }).items;
  assert.equal(personal.filter((e) => e.kind === 'event').length, 1);
  assert.equal(agent.filter((e) => e.kind === 'event').length, 1);
  assert.ok(combined.some((e) => e.kind === 'execution'));
  for (const items of [personal, combined, agent])
    assert.ok(items.every((e) => !chatTurns.includes(e.id) && e.source !== chat.id));
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM execution_ledger WHERE kind='chat'").get().n,
    2,
  );
  workspace.record('done', c.id, 'Done');
  await workspace.action({ action: 'activity-clear' });
  assert.ok(planning.range({ ...span, mode: 'agent' }).items.some((e) => e.id === id));
});
test('Activity bulk clear covers all pages, undo preserves concurrent entries and source evidence', async (t) => {
  const { store, workspace } = setup(t);
  for (let i = 0; i < 120; i++) workspace.record('changed', null, 'row ' + i);
  assert.equal((await workspace.action({ action: 'activity' })).length, 80);
  const undo = await workspace.action({ action: 'activity-clear' });
  assert.equal(undo.count, 120);
  assert.equal((await workspace.action({ action: 'activity' })).length, 0);
  workspace.record('done', null, 'New entry');
  await workspace.action({ action: 'activity-undo', token: undo.token });
  assert.equal(store.db.prepare('SELECT count(*) n FROM activity').get().n, 121);
  const row = (await workspace.action({ action: 'activity' }))[0];
  await workspace.action({ action: 'activity-delete', id: row.id });
  assert.equal(store.db.prepare('SELECT count(*) n FROM activity').get().n, 120);
});
test('personality migration is lossless/idempotent and preferred name remains validated data', (t) => {
  const { store } = setup(t);
  const profile = store.get(store.settings().activeAgent);
  store.mutate({
    id: profile.id,
    data: { personality: 'Warm', systemPrompt: 'Legacy instructions', preferencesVersion: 0 },
  });
  const first = ensureProfiles(store)[0],
    second = ensureProfiles(store)[0];
  assert.equal(first.data.personality, mergePreferences('Warm', 'Legacy instructions'));
  assert.equal(first.revision, second.revision);
  assert.equal(first.data.systemPrompt, '');
  store.setSettings({ preferredName: '  Octavian Ș  ', shareName: false });
  assert.equal(store.settings().preferredName, 'Octavian Ș');
  assert.throws(() => store.setSettings({ preferredName: 'x'.repeat(101) }));
});
test('report saving/reading is inference-free; explicit run uses profile, selected evidence and structured output', async (t) => {
  const { store, planning, agent } = setup(t);
  let calls = 0;
  const original = agent.chat;
  agent.chat = async (args) => {
    calls++;
    assert.ok(store.get(args.conversation).data.reportReadOnly);
    await original(args);
  };
  const template = await planning.action({
    action: 'reports-save',
    title: 'Briefing',
    data: {
      enabled: false,
      agentProfile: store.settings().activeAgent,
      access: true,
      timing: timing(),
      sections: [{ type: 'custom', title: 'Findings', prompt: 'Review', sources: [] }],
    },
  });
  await planning.action({ action: 'reports-read', id: template.id });
  assert.equal(calls, 0);
  const result = await planning.run(template, true);
  assert.equal(calls, 1);
  assert.equal(result.report.data.status, 'done');
  assert.equal(result.report.data.sections[0].title, 'Your day');
  assert.equal(result.report.data.agentProfile, template.data.agentProfile);
});
test('automatic report occurrences are deduplicated, pause/disabled/model loss stop dispatch and uncertain runs need review', async (t) => {
  const { store, planning, agent } = setup(t);
  let calls = 0;
  const original = agent.chat;
  agent.chat = async (a) => {
    calls++;
    await original(a);
  };
  const local = new Date(Date.now() - 60000),
    stamp = new Date(+local - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const template = await planning.action({
    action: 'reports-save',
    title: 'Daily',
    data: {
      enabled: true,
      agentProfile: store.settings().activeAgent,
      access: true,
      timing: {
        start: stamp,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        repeat: 'daily',
      },
      sections: [{ type: 'custom', title: 'Daily', sources: [] }],
    },
  });
  // Editing a future template is inference-free; explicitly set a due occurrence for the scheduler fixture.
  store.mutate({ id: template.id, data: { nextRun: new Date(Date.now() - 60000).toISOString() } });
  await planning.tick();
  assert.equal(calls, 0);
  store.setSettings({ reportsAutomation: true, backgroundPaused: true });
  await planning.tick();
  assert.equal(calls, 0);
  store.setSettings({ backgroundPaused: false });
  await planning.tick();
  await planning.tick();
  assert.equal(calls, 1);
  const count = store.db.prepare('SELECT count(*) n FROM report_occurrences').get().n;
  assert.equal(count, 1);
});
test('explicit report requests queue behind foreground work without dispatching another model', async (t) => {
  const { store, planning, agent } = setup(t);
  const template = await planning.action({
    action: 'reports-save',
    title: 'Queued',
    data: {
      enabled: false,
      access: true,
      agentProfile: store.settings().activeAgent,
      timing: timing(),
      sections: [{ type: 'custom', title: 'Topic', sources: [] }],
    },
  });
  agent.active.set('foreground', {});
  assert.equal((await planning.action({ action: 'reports-run', id: template.id })).queued, true);
  assert.ok(store.get(template.id).data.manualRequested);
  await planning.tick();
  assert.equal(store.all().filter((e) => e.kind === 'report').length, 0);
  agent.active.clear();
  await planning.tick();
  assert.equal(store.get(template.id).data.manualRequested, null);
  assert.equal(store.all().filter((e) => e.kind === 'report').length, 1);
});
test('report sources enforce access, revocation and read-only native tool execution', async (t) => {
  const { store, planning } = setup(t),
    note = store.all().find((e) => e.kind === 'note');
  store.mutate({ id: note.id, data: { access: true } });
  const template = await planning.action({
    action: 'reports-save',
    title: 'Sources',
    data: {
      enabled: false,
      agentProfile: store.settings().activeAgent,
      access: true,
      timing: timing(),
      sections: [{ type: 'custom', title: 'Notes', sources: [note.id] }],
    },
  });
  const { report } = await planning.run(template, true);
  assert.ok(report.data.sources.some((r) => r.id === note.id));
  store.mutate({ id: note.id, data: { access: false } });
  assert.equal(store.access(report.id), false);
  const native = new Agent(store, {}, { tools: () => [], registry: new Map() }, () => {});
  native.planning = planning;
  const ctx = {
    conversation: report.data.conversation,
    profileSettings: profileSettings(store),
    signal: new AbortController().signal,
  };
  await assert.rejects(
    native.execute('calendar_action', { action: 'save', input: {} }, ctx),
    /read-only/,
  );
  await assert.rejects(
    native.execute('edit_item', { id: note.id, data: { content: 'Bad' } }, ctx),
    /read-only/,
  );
  assert.ok(planningInstruction.includes('user approval'));
  assert.equal(planningTools.length, 2);
});
function archive(xml, declaredSize) {
  const name = Buffer.from('word/document.xml'),
    data = Buffer.from(xml),
    local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredSize ?? data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const offset = local.length + name.length + data.length,
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}
test('single recurring occurrence edits are atomic and date-specific, including multiple times on one date', async (t) => {
  const { store, planning } = setup(t),
    calendar = store.all().find((e) => e.kind === 'calendar');
  const event = await planning.action({
    action: 'calendar-save',
    title: 'Twice',
    calendarId: calendar.id,
    data: {
      timing: timing('2026-10-10T09:00', {
        repeat: 'dates',
        dates: ['2026-10-10T09:00', '2026-10-10T15:00'],
      }),
      endLocal: '2026-10-10T10:00',
    },
  });
  const occurrence = wallToUTC('2026-10-10T09:00', 'Europe/Bucharest');
  await assert.rejects(
    planning.action({
      action: 'calendar-split',
      id: event.id,
      revision: event.revision,
      title: 'Invalid',
      occurrence,
      data: { ...event.data, endLocal: '2026-10-10T08:00' },
    }),
    /end/,
  );
  assert.equal(store.get(event.id).revision, event.revision);
  const result = await planning.action({
    action: 'calendar-split',
    id: event.id,
    revision: event.revision,
    title: 'Moved one',
    occurrence,
    data: { ...event.data, timing: timing('2026-10-11T09:00'), endLocal: '2026-10-11T10:00' },
  });
  assert.equal(result.data.timing.repeat, 'none');
  const rows = planning.range({ from: '2026-10-10', to: '2026-10-12', mode: 'personal' }).items;
  assert.equal(rows.filter((r) => r.source === event.id).length, 1);
  assert.equal(rows.filter((r) => r.source === result.id).length, 1);
});
test('all-day events use local midnight and calendar-day ends through DST', async (t) => {
  const { store, planning } = setup(t),
    calendar = store.all().find((e) => e.kind === 'calendar');
  const event = await planning.action({
    action: 'calendar-save',
    title: 'All day',
    calendarId: calendar.id,
    data: {
      timing: { start: '2026-03-08T10:00', timezone: 'America/New_York', repeat: 'none' },
      allDay: true,
      endDate: '2026-03-08',
    },
  });
  const row = planning
    .range({ from: '2026-03-08', to: '2026-03-10', mode: 'personal' })
    .items.find((e) => e.source === event.id);
  assert.equal(Date.parse(row.end) - Date.parse(row.start), 23 * 3600000);
  assert.ok(event.data.timing.start.endsWith('T00:00'));
});
test('compact inventories preserve full reports on disk; conversation pagination orders by message activity', async (t) => {
  const { store, workspace } = setup(t),
    report = store.mutate({
      kind: 'report',
      title: 'Large',
      data: {
        content: 'x'.repeat(100000),
        sections: [{ title: 'Full', content: 'Keep all text' }],
        sources: [],
      },
    });
  assert.equal(store.all(false, true).find((e) => e.id === report.id).data.content, undefined);
  assert.equal(store.get(report.id).data.content.length, 100000);
  const old = store.mutate({ kind: 'conversation', title: 'Old but active' });
  for (let i = 0; i < 85; i++) store.mutate({ kind: 'conversation', title: 'Chat ' + i });
  store.message(old.id, 'user', 'Latest activity');
  const first = await workspace.action({ action: 'conversations-list' });
  assert.equal(first.length, 80);
  assert.equal(first[0].id, old.id);
  assert.equal((await workspace.action({ action: 'conversations-list', offset: 80 })).length, 6);
});
test('report filters run before pagination and custom coverage validates its independent day count', async (t) => {
  const { store, planning } = setup(t);
  const match = store.mutate({
    kind: 'report',
    title: 'Older topic',
    data: {
      summary: 'Unique research finding',
      scheduleRepeat: 'daily',
      agentProfile: store.settings().activeAgent,
      unread: true,
    },
  });
  for (let i = 0; i < 85; i++)
    store.mutate({ kind: 'report', title: 'Newer report ' + i, data: { scheduleRepeat: 'none' } });
  store.db
    .prepare('UPDATE entities SET created=? WHERE id=?')
    .run('2020-01-01T12:00:00.000Z', match.id);
  assert.equal((await planning.action({ action: 'reports-list', outputs: true })).length, 80);
  const filtered = await planning.action({
    action: 'reports-list',
    outputs: true,
    query: 'research finding',
    filter: 'daily',
    profile: store.settings().activeAgent,
    from: '2020-01-01',
    to: '2020-01-01',
  });
  assert.deepEqual(
    filtered.map((e) => e.id),
    [match.id],
  );
  const data = {
    enabled: false,
    agentProfile: store.settings().activeAgent,
    timing: timing(),
    coverage: { mode: 'past', days: 14 },
    sections: [{ type: 'custom', title: 'Topic', sources: [] }],
  };
  const preview = await planning.action({ action: 'reports-preview', data });
  assert.ok(Date.parse(preview.coverage.to) - Date.parse(preview.coverage.from) >= 13 * 86400000);
  await assert.rejects(
    planning.action({
      action: 'reports-preview',
      data: { ...data, coverage: { mode: 'past', days: 367 } },
    }),
    /coverage days/,
  );
});
test('bounded DOCX extraction preserves paragraphs, tables, Unicode and entities without vulnerable CLI dependencies', () => {
  const xml =
    '<w:document><w:p><w:r><w:t>Știință &amp; travel</w:t><w:tab/><w:t>Greece</w:t><w:br/><w:t>Line</w:t></w:r></w:p><w:tc><w:p><w:t>Table</w:t></w:p></w:tc></w:document>';
  assert.match(extractDocx(archive(xml)), /Știință & travel\tGreece\nLine/);
  assert.match(extractDocx(archive(xml)), /Table/);
  assert.throws(() => extractDocx(archive(xml, 60 * 1024 * 1024)), /limits/);
  assert.throws(() => extractDocx(archive('<!DOCTYPE x><w:t>x</w:t>')), /entities/);
  assert.throws(() => extractDocx(Buffer.from('bad')), /archive/);
});

test('one-off reports queue behind foreground work and persist output without creating a template', async (t) => {
  const { store, planning, agent } = setup(t);
  const templates = store.all().filter((e) => e.kind === 'report-template').length;
  agent.active.set('foreground', {});
  const request = await planning.action({
    action: 'reports-custom',
    title: 'Situational report',
    data: {
      agentProfile: store.settings().activeAgent,
      enabled: true,
      timing: timing(undefined, { repeat: 'daily' }),
      sections: [{ type: 'custom', title: 'Situation', sources: [] }],
    },
  });
  assert.equal(store.get(request.report).data.status, 'queued');
  assert.equal(store.get(request.report).data.request.enabled, false);
  assert.equal(store.get(request.report).data.request.timing.repeat, 'none');
  assert.equal(store.all().filter((e) => e.kind === 'report-template').length, templates);
  agent.active.clear();
  await planning.tick();
  const report = store.get(request.report);
  assert.equal(report.data.status, 'done');
  assert.equal(report.data.template, null);
  assert.equal(report.data.oneOff, true);
  assert.ok(store.get(report.data.conversation).data.reportReadOnly);
  assert.equal(agent.stops.length, 0, 'ordinary report mutations must not interrupt a one-off');
  await planning.tick();
  assert.equal(store.all().filter((e) => e.kind === 'report').length, 1);
  assert.equal(store.all().filter((e) => e.kind === 'report-template').length, templates);
});

test('one-off report creation requires native report/profile/model access and cannot be invoked by an agent', async (t) => {
  const { store, planning, agent } = setup(t);
  const input = {
    action: 'reports-custom',
    title: 'One-off',
    data: {
      agentProfile: store.settings().activeAgent,
      timing: timing(),
      sections: [{ type: 'custom', title: 'Topic', sources: [] }],
    },
  };
  store.setSettings({ reportsAccess: false });
  await assert.rejects(planning.action(input), /grant report access/);
  assert.equal(store.all().filter((e) => e.kind === 'report').length, 0);
  store.setSettings({ reportsAccess: true });
  await assert.rejects(
    planning.action(input, { profileSettings: profileSettings(store), conversation: 'agent' }),
    /Only the user/,
  );
  agent.active.set('foreground', {});
  const queued = await planning.action(input);
  store.setSettings({ reportsAccess: false });
  agent.active.clear();
  await planning.tick();
  assert.equal(store.get(queued.report).data.status, 'interrupted');
  assert.equal(store.all().filter((e) => e.kind === 'conversation' && e.data.report).length, 0);
});

test('reopening planning leaves queued one-off reports interrupted for review without retrying', async (t) => {
  const { store, planning, agent } = setup(t);
  agent.active.set('foreground', {});
  const queued = await planning.action({
    action: 'reports-custom',
    title: 'Interrupted request',
    data: {
      agentProfile: store.settings().activeAgent,
      timing: timing(),
      sections: [{ type: 'custom', title: 'Topic', sources: [] }],
    },
  });
  planning.close();
  const reopened = new Planning(store, agent);
  t.after(() => reopened.close());
  assert.equal(store.get(queued.report).data.status, 'interrupted');
  agent.active.clear();
  await reopened.tick();
  assert.equal(store.all().filter((e) => e.kind === 'report-template').length, 0);
  assert.equal(store.get(queued.report).data.status, 'interrupted');
});
