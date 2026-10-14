import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { profileAction, profileSettings } from './profiles.mjs';
import { projectFiles, projectPath } from './projects.mjs';
import { nextOccurrence } from './schedule.mjs';
import { matrixInference } from './matrix-config.mjs';
import { providerInfo, requireConnectedProvider } from './inference-providers.mjs';
export class Workspace {
  constructor(store, vault) {
    this.store = store;
    this.vault = vault;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,created TEXT NOT NULL,type TEXT NOT NULL,entity TEXT,summary TEXT NOT NULL,data TEXT NOT NULL,read INTEGER DEFAULT 0)',
    );
    this.listener = ({ entity, previous, fileChange }) => {
      if (fileChange) {
        this.record('file-change', entity.id, fileChange.path, fileChange);
        return;
      }
      if (!entity || entity.kind === 'agent-profile') return;
      if (
        entity.data.content !== previous?.data.content ||
        entity.deleted !== previous?.deleted ||
        entity.data.status !== previous?.data.status
      )
        this.record(
          entity.data.status ?? (entity.deleted ? 'trash' : 'changed'),
          entity.id,
          entity.title,
          { previousRevision: previous?.revision, revision: entity.revision },
        );
    };
    store.on('changed', this.listener);
  }
  close() {
    this.store.off('changed', this.listener);
    clearTimeout(this.undoTimer);
    this.activityUndo = null;
  }
  record(type, entity, summary, data = {}) {
    const detail = JSON.stringify(data);
    this.store.db
      .prepare('INSERT INTO activity VALUES(?,?,?,?,?,?,0)')
      .run(
        randomUUID(),
        new Date().toISOString(),
        String(type).slice(0, 60),
        entity ?? null,
        String(summary).slice(0, 300),
        detail.length > 10000 ? JSON.stringify({ truncated: true }) : detail,
      );
    this.store.db.exec(
      'DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY created DESC,rowid DESC LIMIT 500)',
    );
  }
  branch(input) {
    const s = this.store,
      original = s.get(input.id);
    if (input.model && (typeof input.model !== 'string' || input.model.length > 500))
      throw Error('Invalid branch model');
    if (original?.kind !== 'conversation' || original.data.task || original.data.matrixTask || original.data.readOnlyMachine)
      throw Error('Branch an ordinary conversation');
    const messages = s.messages(input.id),
      at = messages.findIndex((m) => m.id === input.message);
    if (
      at < 0 ||
      messages[at].role !== 'assistant' ||
      messages[at].data.tool ||
      messages[at].data.modelMessage?.tool_calls?.length
    )
      throw Error('Branch after a complete assistant answer');
    const prefix = messages.slice(0, at + 1);
    if (prefix.length > 2000) throw Error('This branch is too large');
    const effective = profileSettings(s, original);
    const activeModel = original.data.branchModel || effective.model;
    const data = {
      ...original.data,
      agentProfile: original.data.agentProfile || s.settings().activeAgent || undefined,
      branchOf: original.id,
      branchMessage: input.message,
      contextSummary: undefined,
      compactedUntil: undefined,
      chatMetrics: undefined,
      branchModel: input.model || activeModel || null,
      branchProvider: original.data.branchProvider || effective.provider,
    };
    delete data.compaction;
    delete data.summary;
    delete data.lastRun;
    const id = randomUUID(),
      time = new Date().toISOString();
    s.db.exec('BEGIN');
    try {
      s.db
        .prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          'conversation',
          null,
          original.project,
          original.title + ' · Branch',
          JSON.stringify(data),
          1,
          0,
          time,
          time,
        );
      for (const m of prefix) {
        const mid = randomUUID(),
          md = { ...m.data, sharedPrefix: true, originMessage: m.data.originMessage ?? m.id };
        s.db
          .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
          .run(mid, id, m.role, m.content, JSON.stringify(md), m.created);
        if (!md.tool && !md.error && ['user', 'assistant'].includes(m.role))
          s.db.prepare('INSERT INTO message_search VALUES(?,?,?)').run(mid, id, m.content);
      }
      s.index(id);
      s.db.exec('COMMIT');
    } catch (e) {
      s.db.exec('ROLLBACK');
      throw e;
    }
    s.emit('changed', { entity: s.get(id) });
    return s.get(id);
  }
  async action(input) {
    const s = this.store;
    if (input.action === 'conversations-list') {
      if (
        typeof (input.query || '') !== 'string' ||
        String(input.query || '').length > 200 ||
        !Number.isInteger(input.offset || 0) ||
        input.offset < 0
      )
        throw Error('Invalid conversation query');
      s.db.exec(
        'CREATE INDEX IF NOT EXISTS message_conversation_date ON messages(conversation,created)',
      );
      const rows = s.db
        .prepare(
          "SELECT e.*,coalesce((SELECT max(created) FROM messages WHERE conversation=e.id),e.updated) lastMessage FROM entities e WHERE kind='conversation' AND deleted=0 AND title LIKE ? ORDER BY lastMessage DESC,e.updated DESC LIMIT 80 OFFSET ?",
        )
        .all('%' + (input.query || '') + '%', input.offset || 0);
      return rows.map((row) => {
        const e = s.decode(row);
        return {
          ...e,
          data: {
            agentProfile: e.data.agentProfile,
            task: e.data.task,
            report: e.data.report,
            readOnlyMachine: e.data.readOnlyMachine,
          },
          lastMessage: row.lastMessage,
        };
      });
    }
    if (/^(calendar-|reports-|task-report$)/.test(input.action)) return this.planning.action(input);
    if (input.action === 'activity-delete' || input.action === 'activity-clear') {
      const rows =
        input.action === 'activity-clear'
          ? s.db.prepare('SELECT * FROM activity').all()
          : s.db.prepare('SELECT * FROM activity WHERE id=?').all(input.id);
      clearTimeout(this.undoTimer);
      this.activityUndo = { token: randomUUID(), rows, expires: Date.now() + 10000 };
      this.undoTimer = setTimeout(() => {
        this.activityUndo = null;
      }, 10000);
      this.undoTimer.unref?.();
      if (input.action === 'activity-clear') s.db.exec('DELETE FROM activity');
      else s.db.prepare('DELETE FROM activity WHERE id=?').run(input.id);
      return { token: this.activityUndo.token, count: rows.length };
    }
    if (input.action === 'activity-undo') {
      const undo = this.activityUndo;
      this.activityUndo = null;
      if (!undo || undo.token !== input.token || undo.expires < Date.now())
        throw Error('Undo expired');
      const q = s.db.prepare('INSERT OR IGNORE INTO activity VALUES(?,?,?,?,?,?,?)');
      for (const r of undo.rows)
        q.run(r.id, r.created, r.type, r.entity, r.summary, r.data, r.read);
      s.db.exec(
        'DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY created DESC,rowid DESC LIMIT 500)',
      );
      return true;
    }
    if (String(input.action).startsWith('profile-'))
      return profileAction(s, { ...input, action: input.action.slice(8) });
    if (input.action === 'activity')
      return s.db
        .prepare('SELECT * FROM activity ORDER BY created DESC,rowid DESC LIMIT 80 OFFSET ?')
        .all(Math.max(0, Math.min(500, input.offset ?? 0)))
        .map((r) => ({ ...r, data: JSON.parse(r.data), item: s.get(r.entity) }));
    if (input.action === 'read-activity') {
      s.db.prepare('UPDATE activity SET read=1 WHERE id=?').run(input.id);
      return true;
    }
    if (input.action === 'visit') {
      if (!s.get(input.id)) return false;
      s.setSettings({
        recentItems: [
          { id: input.id, at: Date.now() },
          ...s.settings().recentItems.filter((e) => e.id !== input.id),
        ].slice(0, 100),
      });
      return true;
    }
    if (input.action === 'pin') {
      const pins = s.settings().pinnedItems.filter((id) => id !== input.id);
      if (input.enabled && s.get(input.id)) pins.push(input.id);
      s.setSettings({ pinnedItems: pins.slice(0, 40) });
      return true;
    }
    if (input.action === 'pin-order') {
      const pins = [...s.settings().pinnedItems],
        at = pins.indexOf(input.id),
        to = at + (input.direction < 0 ? -1 : 1);
      if (at < 0 || to < 0 || to >= pins.length) return false;
      [pins[at], pins[to]] = [pins[to], pins[at]];
      s.setSettings({ pinnedItems: pins });
      return true;
    }
    if (input.action === 'history')
      return s.db
        .prepare(
          "SELECT revision,updated,json_extract(data,'$.title') AS title,substr(coalesce(json_extract(data,'$.data.content'),''),1,64000) AS content,coalesce(json_extract(data,'$.data.editedBy'),'User or agent') AS actor FROM versions WHERE id=? ORDER BY revision DESC LIMIT 30",
        )
        .all(input.id);
    if (input.action === 'restore') {
      const item = s.get(input.id),
        row = s.db
          .prepare('SELECT data FROM versions WHERE id=? AND revision=?')
          .get(input.id, input.version),
        version = row ? { data: JSON.parse(row.data) } : null;
      if (!item || !version || item.revision !== input.revision)
        throw Error('This item changed. Reload before restoring.');
      if (!['note', 'vault-file', 'skill', 'card'].includes(item.kind))
        throw Error('This item does not support content restore');
      const content = version.data.data?.content ?? '';
      const result =
        item.kind === 'vault-file'
          ? this.vault.update({ id: item.id, revision: item.revision, content })
          : s.mutate({
              id: item.id,
              revision: item.revision,
              data: { content, editedBy: 'User restore' },
            });
      this.record('restored', item.id, item.title, { from: input.version });
      return result;
    }
    if (input.action === 'undo-change') {
      const item = s.get(input.id);
      if (
        !item ||
        item.revision !== input.revision ||
        !['note', 'card', 'skill', 'vault-file'].includes(item.kind)
      )
        throw Error('This item changed. Review history before undoing.');
      if (input.beforeRevision === 0)
        return item.kind === 'vault-file'
          ? this.vault.trash(item.id)
          : s.mutate({ id: item.id, revision: item.revision, action: 'trash' });
      return this.action({
        action: 'restore',
        id: item.id,
        revision: item.revision,
        version: input.beforeRevision,
      });
    }
    if (input.action === 'branch') return this.branch(input);
    if (input.action === 'chapter-content-note') {
      const chapter = s.get(input.id);
      if (chapter?.kind !== 'chapter' || chapter.revision !== input.revision)
        throw Error('This chapter changed. Reload before copying its saved content.');
      if (typeof chapter.data.content !== 'string' || !chapter.data.content.trim())
        throw Error('This chapter has no saved body content.');
      const existing = s
        .children(chapter.id)
        .find(
          (e) =>
            e.kind === 'note' &&
            e.data.copiedChapter === chapter.id &&
            e.data.copiedChapterRevision === chapter.revision,
        );
      if (existing) return existing;
      return s.mutate({
        kind: 'note',
        parent: chapter.id,
        project: chapter.project,
        title: chapter.title,
        data: {
          content: chapter.data.content,
          copiedChapter: chapter.id,
          copiedChapterRevision: chapter.revision,
        },
      });
    }
    if (input.action === 'conversation-model') {
      const item = s.get(input.id);
      if (
        item?.kind !== 'conversation' ||
        item.data.matrixTask ||
        typeof input.model !== 'string' ||
        !input.model.trim() ||
        input.model.length > 500
      )
        throw Error('Choose a model for an ordinary conversation');
      const provider = input.provider ?? profileSettings(s, item).provider;
      providerInfo(provider);
      requireConnectedProvider({ ...s.settings(), provider });
      return s.mutate({
        id: item.id,
        data: { branchModel: input.model, branchProvider: provider },
      });
    }
    if (input.action === 'active-model') {
      if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 500)
        throw Error('Choose a model');
      const profile = s.get(s.settings().activeAgent);
      const provider = input.provider ?? profileSettings(s).provider;
      providerInfo(provider);
      requireConnectedProvider({ ...s.settings(), provider });
      if (!profile || profile.data.inheritModel)
        return s.setSettings({ provider, model: input.model });
      return profileAction(s, {
        action: 'save',
        id: profile.id,
        revision: profile.revision,
        title: profile.title,
        data: { provider, model: input.model },
      });
    }
    if (input.action === 'matrix-preview') {
      const task = s.get(input.id);
      if (task?.kind !== 'matrix-task') throw Error('Choose a Matrix task');
      let list = s.get(task.parent);
      while (list?.kind === 'matrix-task') list = s.get(list.parent);
      const settings = matrixInference(
          profileSettings(s),
          s.settings().matrixPreload ? list?.data.modelProfile : null,
        ),
        occurrences = [];
      if (!task.data.trigger || task.data.trigger.kind === 'time') {
        let start = task.data.schedule?.start;
        for (let i = 0; start && i < 4; i++) {
          occurrences.push({
            start,
            preparation: s.settings().matrixPreload
              ? new Date(
                  Date.parse(start) - s.settings().matrixPreloadMinutes * 60000,
                ).toISOString()
              : null,
          });
          start = nextOccurrence({ ...task.data.schedule, start }, new Date(Date.parse(start)));
        }
      }
      return {
        model: settings.model,
        provider: settings.provider,
        trigger: task.data.trigger?.kind ?? 'time',
        timezone: task.data.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        paused: s.settings().backgroundPaused,
        integrated: list?.data.integrated,
        accessible: s.access(task.id, true),
        occurrences,
        timeline: s.db
          .prepare('SELECT * FROM runs WHERE card=? ORDER BY start DESC LIMIT 20')
          .all(task.id),
      };
    }
    if (input.action === 'receipt') {
      const message = s.messages(input.id).find((m) => m.id === input.message);
      if (!message) throw Error('Message not found');
      const receipt = message.data.receipt ?? {};
      return {
        ...receipt,
        changes: (receipt.changes ?? []).map((r) => ({
          ...r,
          title: s.access(r.id) ? s.get(r.id)?.title : null,
        })),
        context: (receipt.context ?? []).map((r) => ({
          ...r,
          title: s.access(r.id) ? s.get(r.id)?.title : null,
        })),
        memories: (receipt.memories ?? []).map((r) => ({
          ...r,
          title: s.access(r.id) ? s.get(r.id)?.title : null,
        })),
        skills: (receipt.skills ?? []).map((r) => ({
          ...r,
          title: s.access(r.id) ? s.get(r.id)?.title : null,
        })),
      };
    }
    if (input.action === 'project-files') {
      if (['history', 'restore-version'].includes(input.operation)) {
        const target = await projectPath(s, input.project, input.path, {
          user: true,
          edit: input.operation === 'restore-version',
        });
        const names = fs
          .readdirSync(path.dirname(target.file))
          .filter((name) => name.startsWith(path.basename(target.file) + '.intelligence-backup-'))
          .sort()
          .reverse()
          .slice(0, 30);
        if (input.operation === 'history')
          return names
            .map((name) => {
              const full = path.join(path.dirname(target.file), name),
                stat = fs.lstatSync(full);
              if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
                return null;
              return {
                path: path.relative(target.root, full),
                time: stat.mtime.toISOString(),
                content: fs.readFileSync(full, 'utf8'),
              };
            })
            .filter(Boolean);
        const version = await projectPath(s, input.project, input.versionPath, { user: true });
        if (
          path.dirname(version.file) !== path.dirname(target.file) ||
          !names.includes(path.basename(version.file))
        )
          throw Error('Choose a saved revision of this file');
        const stat = fs.lstatSync(version.file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
          throw Error('Invalid file revision');
        return projectFiles(
          s,
          {
            action: 'write',
            project: input.project,
            path: input.path,
            revision: input.revision,
            content: fs.readFileSync(version.file, 'utf8'),
          },
          { user: true },
        );
      }
      if (input.operation === 'write' && !input.revision)
        throw Error('Read the current file before saving');
      const result = await projectFiles(s, { ...input, action: input.operation }, { user: true });
      if (input.operation === 'write')
        this.record('file-change', input.project, input.path, {
          path: input.path,
          actor: 'User',
          revision: result.revision,
        });
      return result;
    }
    if (input.action === 'bulk') {
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100)
        throw Error('Select between 1 and 100 items');
      const selected = input.items.map(({ id, revision }) => {
        const e = s.get(id);
        if (!e || e.revision !== revision)
          throw Error('A selected item changed. Refresh the selection.');
        return e;
      });
      const ids = new Set(selected.map((e) => e.id)),
        roots = selected.filter((e) => {
          let p = e.parent;
          while (p) {
            if (ids.has(p)) return false;
            p = s.get(p)?.parent;
          }
          return true;
        });
      if (roots.some((e) => e.kind === 'agent-profile' || e.kind === 'matrix-list'))
        throw Error('This collection cannot be changed in bulk');
      if (input.operation === 'export') {
        const all = s.all(false, true),
          graph = new Map();
        for (const item of all) {
          if (!graph.has(item.parent)) graph.set(item.parent, []);
          graph.get(item.parent).push(item);
        }
        let count = 0;
        const walk = (id) => {
          const result = [];
          for (const e of graph.get(id) ?? []) {
            if (++count > 2000) throw Error('Use a complete backup for larger exports');
            result.push(e.kind === 'vault-file' ? this.vault.read(e.id) : e, ...walk(e.id));
          }
          return result;
        };
        const exported = roots.map((e) => ({
          entity: e.kind === 'vault-file' ? this.vault.read(e.id) : e,
          descendants: walk(e.id),
        }));
        if (Buffer.byteLength(JSON.stringify(exported)) > 20 * 1024 * 1024)
          throw Error('Use a complete backup for larger exports');
        return exported;
      }
      if (!['trash', 'move'].includes(input.operation)) throw Error('Unsupported bulk action');
      if (input.operation === 'move')
        for (const e of roots) {
          const parent = s.get(input.parent);
          if (
            !parent ||
            e.id === parent.id ||
            s.children(e.id, true).some((v) => v.id === parent.id) ||
            !(e.kind.startsWith('vault-')
              ? parent.kind === 'vault-folder'
              : e.kind === 'card'
                ? parent.kind === 'list'
                : e.kind === 'note'
                  ? ['notebook', 'chapter'].includes(parent.kind)
                  : e.kind === 'chapter' && parent.kind === 'notebook')
          )
            throw Error('Choose a compatible destination for all selected items');
        }
      const results = [];
      if (roots.every((e) => !e.kind.startsWith('vault-'))) {
        s.db.exec('BEGIN');
        try {
          for (const e of roots)
            results.push({
              id: e.id,
              ok: true,
              result: s.mutate({
                id: e.id,
                revision: e.revision,
                ...(input.operation === 'trash' ? { action: 'trash' } : { parent: input.parent }),
              }),
            });
          s.db.exec('COMMIT');
          return results;
        } catch (error) {
          s.db.exec('ROLLBACK');
          throw error;
        }
      }
      for (const e of roots) {
        try {
          const result = e.kind.startsWith('vault-')
            ? input.operation === 'trash'
              ? this.vault.trash(e.id)
              : this.vault.update({ id: e.id, revision: e.revision, parent: input.parent })
            : s.mutate({
                id: e.id,
                revision: e.revision,
                ...(input.operation === 'trash' ? { action: 'trash' } : { parent: input.parent }),
              });
          results.push({ id: e.id, ok: true, result });
        } catch (error) {
          results.push({ id: e.id, ok: false, error: error.message });
        }
      }
      return results;
    }
    throw Error('Unknown workspace action');
  }
}
