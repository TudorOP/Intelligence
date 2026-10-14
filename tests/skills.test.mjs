import test from 'node:test';
import { Agent } from '../electron/agent.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { ensureProfiles, profileSettings, profileAction } from '../electron/profiles.mjs';
import { skillAction, canReadSkill, relevantSkills } from '../electron/skills.mjs';
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-skills-')),
    store = new Store(dir);
  ensureProfiles(store);
  const conversation = store.mutate({ kind: 'conversation', title: 'Learn' });
  const ctx = {
    conversation: conversation.id,
    profileSettings: profileSettings(store, conversation),
  };
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, ctx };
}
const input = {
  action: 'create',
  title: 'Verify recurring exports',
  description: 'Reliable repeated exports',
  triggers: 'export backup',
  instructions:
    'Use when exporting. Check permissions, write to the selected destination, verify the result and report errors. Never repeat uncertain writes.',
};
test('agents create bounded reusable skills with provenance and persistent revisions', (t) => {
  const { store, ctx } = setup(t);
  const s = skillAction(store, input, ctx);
  assert.equal(s.data.creatorProfile, ctx.profileSettings.profileId);
  assert.equal(s.data.access, true);
  assert.ok(relevantSkills(store, ctx.profileSettings, 'export backup').some((e) => e.id === s.id));
  assert.throws(() => skillAction(store, input, ctx), /already exists/);
  const r = skillAction(
    store,
    {
      action: 'revise',
      id: s.id,
      revision: s.revision,
      instructions: 'Verify exported bytes and recover gracefully.',
    },
    ctx,
  );
  assert.equal(r.revision, s.revision + 1);
  assert.throws(
    () => skillAction(store, { action: 'revise', id: s.id, revision: s.revision }, ctx),
    /revision/,
  );
});
test('review, off, profile revocation and temporary/report modes prevent autonomous activation', async (t) => {
  const { store, ctx } = setup(t);
  store.setSettings({ skillLearning: 'review' });
  const s = skillAction(store, input, ctx);
  assert.equal(s.data.access, false);
  assert.equal(canReadSkill(store, s, ctx.profileSettings), false);
  store.setSettings({ skillLearning: 'off' });
  assert.throws(() => skillAction(store, { ...input, title: 'Other' }, ctx), /disabled/);
  const agent = new Agent(store, {}, { registry: new Map(), tools: () => [] }, () => {});
  await assert.rejects(() => agent.execute('create_item', { kind: 'skill', title: 'Bypass', content: 'Attempt generic creation' }, { ...ctx, signal: new AbortController().signal }), /disabled/);
  await assert.rejects(() => agent.execute('edit_item', { id: s.id, revision: s.revision, content: 'Attempt generic revision' }, { ...ctx, signal: new AbortController().signal }), /scope|access/);
  store.setSettings({ skillLearning: 'automatic' });
  store.mutate({ id: ctx.profileSettings.profileId, data: { allowSkillCreation: false } });
  assert.throws(() => skillAction(store, input, ctx), /disabled/);
  store.mutate({ id: ctx.profileSettings.profileId, data: { allowSkillCreation: true } });
  store.mutate({ id: ctx.conversation, data: { temporary: true } });
  assert.throws(() => skillAction(store, input, ctx), /disabled/);
});
test('generated skills do not escape owner or explicit skill scopes; relevance is bounded', (t) => {
  const { store, ctx } = setup(t);
  const s = skillAction(store, input, ctx);
  const p = profileAction(store, {
    action: 'save',
    title: 'Other',
    data: { inheritModel: true, toolGroups: null, skillIds: null },
  });
  const other = profileSettings(store, { data: { agentProfile: p.id } });
  assert.equal(canReadSkill(store, s, other), false);
  store.mutate({ id: ctx.profileSettings.profileId, data: { skillIds: [] } });
  assert.equal(canReadSkill(store, s, ctx.profileSettings), false);
  store.mutate({ id: ctx.profileSettings.profileId, data: { skillIds: null } });
  for (let i = 0; i < 20; i++)
    store.mutate({
      kind: 'skill',
      title: 'Export ' + i,
      data: { access: true, content: 'Verify', description: 'export' },
    });
  assert.equal(relevantSkills(store, ctx.profileSettings, 'export').length, 8);
  assert.throws(() => store.setSettings({ skillLearning: 'whatever' }));
});
