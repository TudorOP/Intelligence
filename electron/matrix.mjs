import { randomUUID } from 'node:crypto';
import { MatrixFiles } from './matrix-files.mjs';
import { nextOccurrence } from './schedule.mjs';
import { matrixInference } from './matrix-config.mjs';
import { profileSettings } from './profiles.mjs';
import { requireAssignedAgent } from './assignments.mjs';
import { residentModel, prepareModel } from './model-residency.mjs';
import { providerInfo } from './inference-providers.mjs';
import { MatrixTriggers } from './matrix-triggers.mjs';

export const matrixSlots = ['core', 'secondary', 'tertiary'];
const completionToken = (source) =>
  [source?.data.completedAt, source?.data.lastCompletedAt].filter(Boolean).sort().at(-1) ??
  source?.updated;
const verifiedCompletion = (source) =>
  source &&
  (source.data.status === 'done' ||
    (source.data.status === 'queued' && source.data.lastCompletedAt)) &&
  (source.kind !== 'matrix-task' || source.data.verification);
export class CognitionMatrix {
  constructor(store, agent, emit = () => {}, runtime = {}) {
    this.store = store;
    this.agent = agent;
    this.emit = emit;
    this.files = new MatrixFiles(store);
    this.running = null;
    this.cursor = -1;
    this.timer = null;
    this.closed = false;
    this.started = false;
    this.dispatching = false;
    this.runtime = { residentModel, prepareModel, ...runtime };
    this.preparation = null;
    this.prepared = new Map();
    this.triggers = new MatrixTriggers(this, runtime);
    this.onChange = () => this.refresh();
    store.on('changed', this.onChange);
    const interrupted = store
      .all(false, true)
      .filter((e) => e.kind === 'matrix-task' && e.data.status === 'running');
    for (const task of interrupted)
      store.db
        .prepare(
          "UPDATE runs SET status='needs_input',end=?,result=? WHERE card=? AND status='running'",
        )
        .run(new Date().toISOString(), 'Interrupted run requires review.', task.id);
    for (const task of store
      .all(false, true)
      .filter((e) => e.kind === 'matrix-task' && e.data.status === 'running'))
      store.mutate({
        id: task.id,
        data: {
          status: 'needs_input',
          result: 'The previous run was interrupted. Review the conversation and retry when ready.',
          awaitingApproval: false,
        },
      });
  }
  changed() {
    this.emit({ type: 'changed' });
  }
  tasks() {
    return this.store.db
      .prepare("SELECT * FROM entities WHERE kind='matrix-task' AND deleted=0 ORDER BY created")
      .all()
      .map((row) => this.store.decode(row));
  }
  profile(list) {
    if (
      list.data.assignedAgent &&
      this.store.get(list.data.assignedAgent)?.kind !== 'agent-profile'
    )
      return {
        ...this.store.settings(),
        model: '',
        profileId: list.data.assignedAgent,
        unavailableAgent: true,
        matrixExecution: true,
      };
    const id = list.data.assignedAgent ? requireAssignedAgent(this.store, list) : null;
    const settings = profileSettings(this.store, id ? { data: { agentProfile: id } } : null);
    const value = matrixInference(settings, id ? null : list.data.modelProfile);
    return { ...value, matrixExecution: true, matrixLoadedOnly: !settings.matrixPreload };
  }
  preparationKey(task, list) {
    const profile = this.profile(list);
    return JSON.stringify([
      task.id,
      task.data.schedule?.start ?? null,
      profile.provider,
      profile.endpoint,
      profile.model,
      profile.profileId,
      this.store.get(profile.profileId)?.revision,
      this.store.settings().matrixPreload,
      this.store.settings().tools,
    ]);
  }
  triggerError(id, message) {
    const task = this.store.get(id);
    if (!task || task.data.status === 'needs_input') return;
    this.store.mutate({
      id,
      data: { status: 'needs_input', result: message, triggerPending: false },
    });
    this.changed();
  }
  refresh() {
    if (this.closed) return;
    if (this.store.settings().backgroundPaused) {
      clearTimeout(this.timer);
      this.timer = null;
      this.preparation?.controller.abort();
      this.checking?.controller.abort();
      this.prepared.clear();
      if (this.started) this.triggers.reconcile();
      if (this.running)
        this.stop('Background AI is paused. Review progress before retrying.', 'paused');
      return;
    }
    if (this.preparation) {
      const task = this.store.get(this.preparation.task),
        list = this.store.get(this.preparation.list);
      if (
        !task ||
        !list ||
        !this.store.assigned(task.id) ||
        !this.runnable(task) ||
        !this.store.settings().matrixPreload ||
        this.preparation.key !== this.preparationKey(task, list) ||
        this.agent.active.size
      )
        this.preparation.controller.abort();
    }
    if (this.checking) {
      const task = this.store.get(this.checking.task),
        list = this.store.get(this.checking.list);
      if (
        !task ||
        !list ||
        !this.store.assigned(task.id) ||
        !this.runnable(task) ||
        this.agent.active.size ||
        this.checking.key !== this.preparationKey(task, list)
      )
        this.checking.controller.abort();
    }
    for (const [id, record] of this.prepared) {
      const list = this.store.get(id),
        task = this.store.get(record.task);
      if (
        !list ||
        !task ||
        !this.store.assigned(task.id) ||
        !this.runnable(task) ||
        record.key !== this.preparationKey(task, list) ||
        !this.store.settings().matrixPreload
      )
        this.prepared.delete(id);
    }
    if (this.started) this.triggers.reconcile();
    if (this.running) {
      const task = this.store.get(this.running.task);
      if (!task || !this.store.assigned(task.id))
        this.stop('Matrix integration was paused or access changed.');
      return;
    }
    if (!this.started) return;
    for (const task of this.tasks().filter(
      (e) =>
        e.data.status === 'done' &&
        e.data.trigger?.kind === 'completion' &&
        this.store.assigned(e.id),
    )) {
      const source = this.store.get(task.data.trigger.source);
      const token = completionToken(source);
      if (
        verifiedCompletion(source) &&
        this.store.access(source.id) &&
        task.data.lastTriggerToken !== token
      )
        this.store.mutate({ id: task.id, data: { status: 'queued', result: '' } });
    }
    // Coalesce store mutations and use one deadline timer, never a per-task polling loop.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pump(), 20);
    this.timer.unref?.();
  }
  async pump() {
    this.timer = null;
    if (this.closed) return;
    try {
      await this.tick();
    } catch (e) {
      this.emit({ type: 'notice', error: e.message });
    } finally {
      this.arm();
    }
  }
  arm() {
    if (
      this.closed ||
      !this.started ||
      this.running ||
      this.dispatching ||
      this.store.settings().backgroundPaused
    )
      return;
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.store.settings().matrixAccess || !this.store.settings().tools) return;
    const now = Date.now(),
      lead = this.store.settings().matrixPreloadMinutes * 60000;
    let delay = Infinity;
    const tasks = this.tasks().filter((task) => this.runnable(task));
    const nearest = tasks
      .filter((task) => Date.parse(task.data.schedule?.start) > now)
      .sort((a, b) => Date.parse(a.data.schedule.start) - Date.parse(b.data.schedule.start))[0];
    for (const task of tasks) {
      if (!this.runnable(task)) continue;
      const start = Date.parse(task.data.schedule?.start ?? '') || now;
      const list = this.listFor(task.id);
      const record = this.prepared.get(list.id);
      let deadline = Math.max(start, this.cooldownDeadline(task));
      if (
        task.id === nearest?.id &&
        this.store.settings().matrixPreload &&
        !providerInfo(this.profile(list).provider).cloud &&
        record?.key !== this.preparationKey(task, list)
      )
        deadline -= lead;
      delay = Math.min(delay, Math.max(20, deadline - now));
    }
    if (!Number.isFinite(delay)) return;
    // Only pending work blocked by foreground chat gets a coarse retry, not idle lists.
    if (this.agent.active.size) delay = Math.max(5000, delay);
    this.timer = setTimeout(() => void this.pump(), Math.min(delay, 2147483647));
    this.timer.unref?.();
  }
  runnable(task) {
    if (
      !task ||
      task.kind !== 'matrix-task' ||
      (task.data.status ?? 'queued') !== 'queued' ||
      !this.store.assigned(task.id)
    )
      return false;
    if (this.listFor(task.id).data.attention) return false;
    if (
      ['file', 'git', 'system', 'external'].includes(task.data.trigger?.kind) &&
      !task.data.triggerPending
    )
      return false;
    if (task.data.trigger?.kind === 'completion') {
      const source = this.store.get(task.data.trigger.source);
      const token = completionToken(source);
      if (
        !source ||
        !this.store.access(source.id) ||
        !verifiedCompletion(source) ||
        (!task.data.triggerPending && task.data.lastTriggerToken === token)
      )
        return false;
    }
    let parent = this.store.get(task.parent);
    while (parent?.kind === 'matrix-task') {
      if (['failed', 'needs_input', 'paused'].includes(parent.data.status)) return false;
      parent = this.store.get(parent.parent);
    }
    return this.store
      .children(task.id, true)
      .filter((e) => e.kind === 'matrix-task')
      .every((e) => e.data.status === 'done');
  }
  cooldownDeadline(task) {
    if (task.data.trigger?.kind !== 'completion' || task.data.triggerPending) return 0;
    return (
      (Date.parse(task.data.lastTriggeredAt ?? '') || 0) +
      (task.data.trigger.cooldownSeconds ?? 60) * 1000
    );
  }
  unavailable(task, list, message) {
    const next = nextOccurrence(task.data.schedule);
    this.store.mutate({
      id: task.id,
      data: {
        status: next ? 'queued' : 'needs_input',
        result: message,
        triggerPending: false,
        lastAttemptAt: new Date().toISOString(),
        unavailableOccurrence: {
          due: task.data.schedule?.start ?? task.data.lastTriggeredAt ?? new Date().toISOString(),
          reason: message,
        },
        ...(next ? { schedule: { ...task.data.schedule, start: next } } : {}),
      },
    });
    this.store.mutate({ id: list.id, data: { modelNotice: task.title + ': ' + message } });
    this.changed();
  }
  async prepare(task, list) {
    const key = this.preparationKey(task, list);
    const controller = new AbortController();
    const job = { key, task: task.id, list: list.id, controller };
    this.preparation = job;
    this.changed();
    try {
      const profile = this.profile(list);
      await this.runtime.prepareModel(
        profile,
        controller.signal,
        this.agent.providerRuntime?.(profile) ?? {},
      );
      controller.signal.throwIfAborted();
      this.prepared.set(list.id, { key, task: task.id });
    } catch (error) {
      if (!controller.signal.aborted) {
        this.prepared.set(list.id, { key, task: task.id, error: error.message });
        this.store.mutate({ id: list.id, data: { modelNotice: error.message } });
      }
    } finally {
      if (this.preparation === job) this.preparation = null;
      if (!this.closed) this.changed();
    }
  }
  affectsRun(id) {
    if (!this.running) return false;
    let task = this.store.get(this.running.task, true);
    while (task) {
      if (task.id === id) return true;
      task = task.parent ? this.store.get(task.parent, true) : null;
    }
    return this.store.children(this.running.task, true, true).some((e) => e.id === id);
  }
  lists() {
    return matrixSlots.map((slot) => this.store.get('matrix-' + slot)).filter(Boolean);
  }
  listFor(id) {
    let item = this.store.get(id);
    const visited = new Set();
    while (item && item.kind !== 'matrix-list') {
      if (visited.has(item.id)) throw new Error('Invalid Matrix hierarchy');
      visited.add(item.id);
      item = item.parent ? this.store.get(item.parent) : null;
    }
    if (!item) throw new Error('Matrix list not found');
    return item;
  }
  scope(id, ctx) {
    const task = this.store.get(id),
      root = this.store.get(ctx.task);
    if (
      task?.kind !== 'matrix-task' ||
      root?.kind !== 'matrix-task' ||
      !this.store.assigned(root.id) ||
      !this.store.access(id, true) ||
      this.store.get(ctx.conversation)?.data.matrixTask !== root.id ||
      !(id === root.id || this.store.children(root.id, true).some((e) => e.id === id))
    )
      throw new Error('Task is outside this Matrix run');
    return task;
  }
  taskData(id, offset = 0) {
    const task = this.store.get(id);
    if (task?.kind !== 'matrix-task' || !this.store.access(id))
      throw new Error('Matrix task is outside current access');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid task offset');
    const list = this.listFor(id);
    const ancestors = [];
    let parent = this.store.get(task.parent);
    while (parent?.kind === 'matrix-task') {
      ancestors.unshift({
        id: parent.id,
        title: parent.title,
        description: (parent.data.content ?? '').slice(0, 12000),
      });
      parent = this.store.get(parent.parent);
    }
    const children = this.store.children(id).filter((e) => this.store.access(e.id));
    const description = task.data.content ?? '';
    return {
      id,
      title: task.title,
      revision: task.revision,
      status: task.data.status ?? 'queued',
      output: task.data.output ?? 'auto',
      incomingFiles: task.data.watchBatch || [],
      schedule: task.data.schedule ?? null,
      trigger:
        task.data.trigger?.source && !this.store.access(task.data.trigger.source)
          ? { kind: task.data.trigger.kind, unavailable: true }
          : {
              ...(task.data.trigger ?? { kind: 'time' }),
              detail: task.data.triggerDetail ?? null,
              lastTriggeredAt: task.data.lastTriggeredAt ?? null,
            },
      description: description.slice(offset, offset + 12000),
      nextOffset: offset + 12000 < description.length ? offset + 12000 : null,
      list: {
        id: list.id,
        title: list.title,
        description: (list.data.description ?? '').slice(0, 12000),
        integrated: list.data.integrated,
      },
      ancestors,
      subtasks: children
        .filter((e) => e.kind === 'matrix-task')
        .map((e) => ({
          id: e.id,
          title: e.title,
          status: e.data.status ?? 'queued',
          enabled: e.data.enabled !== false,
        })),
      attachments: children
        .filter((e) => e.kind === 'matrix-file')
        .map((e) => ({
          id: e.id,
          name: e.title,
          mime: e.data.mime,
          size: e.data.size,
          generated: e.data.generated,
        })),
      responses: children
        .filter((e) => e.kind === 'matrix-entry')
        .slice(-12)
        .map((e) => ({
          id: e.id,
          role: e.data.role,
          content: String(e.data.content ?? '').slice(0, 8000),
          created: e.created,
        })),
      result: task.data.result,
      verification: task.data.verification,
    };
  }
  respond(id, content, role = 'assistant') {
    if (typeof content !== 'string' || !content.trim() || content.length > 100000)
      throw new Error('Response must contain up to 100,000 characters');
    const last = this.store
      .children(id)
      .filter((e) => e.kind === 'matrix-entry')
      .at(-1);
    if (last?.data.role === role && last.data.content === content) return last;
    const entry = this.store.mutate({
      kind: 'matrix-entry',
      parent: id,
      title: role === 'user' ? 'Your response' : 'Agent response',
      data: { role, content, run: this.running?.run ?? null },
    });
    this.changed();
    return entry;
  }
  queue(id) {
    this.triggers.inbox.retry(id);
    const task = this.store.get(id);
    if (task?.kind !== 'matrix-task') throw new Error('Matrix task not found');
    if (
      this.running &&
      (this.running.task === id ||
        this.store.children(id, true).some((e) => e.id === this.running.task))
    )
      throw new Error('Stop this run before retrying');
    this.store.mutate({
      id,
      data: {
        status: 'queued',
        approvedMissedStart: task.data.schedule?.start ?? null,
        enabled: true,
        awaitingApproval: false,
        result: '',
        verification: '',
        triggerPending: Boolean(
          task.data.startedAt || task.data.lastTriggeredAt || task.data.lastAttemptAt,
        ),
      },
    });
    const list = this.listFor(id);
    this.prepared.delete(list.id);
    if (list.data.modelNotice) this.store.mutate({ id: list.id, data: { modelNotice: null } });
    if (list.data.attention?.task === id)
      this.store.mutate({ id: list.id, data: { attention: null } });
    let parent = this.store.get(task.parent);
    while (parent?.kind === 'matrix-task') {
      if (['needs_input', 'failed', 'done'].includes(parent.data.status))
        this.store.mutate({ id: parent.id, data: { status: 'queued', result: '' } });
      parent = this.store.get(parent.parent);
    }
    this.changed();
  }
  reply(id, content) {
    const task = this.store.get(id);
    if (task?.kind !== 'matrix-task') throw new Error('Matrix task not found');
    if (this.running?.task === id)
      throw new Error('Use the pending approval or stop the current run before sending a reply');
    this.respond(id, content, 'user');
    if (task.data.conversation && this.store.get(task.data.conversation))
      this.store.message(task.data.conversation, 'user', content);
    const list = this.listFor(id);
    if (list.data.attention?.task === id)
      this.store.mutate({ id: list.id, data: { attention: null } });
    this.queue(id);
  }
  outcome(args, ctx) {
    const task = this.scope(args.id, ctx);
    if (!['done', 'failed', 'needs_input'].includes(args.status) || !args.message?.trim())
      throw new Error('Choose done, failed or needs_input and explain the result');
    if (args.status === 'done') {
      if (!args.verification?.trim())
        throw new Error('Describe the concrete verification before marking done');
      if (
        this.store
          .children(task.id, true)
          .some((e) => e.kind === 'matrix-task' && e.data.status !== 'done')
      )
        throw new Error('Complete all subtasks before marking their parent done');
      if (
        task.data.output === 'report' &&
        !this.store
          .children(task.id)
          .some(
            (e) => e.kind === 'matrix-file' && e.data.generated && e.data.run === this.running?.run,
          )
      )
        throw new Error('Attach a generated report before completing this task');
    }
    if (args.scope === 'list') {
      if (args.status !== 'needs_input') throw new Error('List attention uses needs_input');
      const list = this.listFor(task.id);
      this.store.mutate({
        id: list.id,
        data: { attention: { task: task.id, message: args.message.slice(0, 20000) } },
      });
    }
    const answered = this.store
      .children(task.id)
      .some(
        (e) =>
          e.kind === 'matrix-entry' &&
          e.data.role === 'assistant' &&
          e.data.run === this.running?.run,
      );
    if (!answered) this.respond(task.id, args.message);
    this.store.mutate({
      id: task.id,
      data: {
        status: args.status,
        result: args.message.slice(0, 20000),
        verification: (args.verification ?? '').slice(0, 10000),
        awaitingApproval: false,
        completedAt: new Date().toISOString(),
      },
    });
    this.changed();
    return { saved: true, status: args.status, id: task.id };
  }
  async search(query, signal) {
    return this.agent.webSearch.search({ query, provider: 'searxng' }, signal);
  }
  async execute(name, args, ctx) {
    if (name === 'matrix_read_task') return this.taskData(args.id, args.offset ?? 0);
    if (name === 'matrix_read_attachment')
      return this.files.read(args.id, args.offset ?? 0, ctx.signal);
    if (name === 'searxng_search') return this.search(args.query, ctx.signal);
    if (name === 'matrix_outcome') return this.outcome(args, ctx);
    if (name === 'matrix_respond') {
      this.scope(args.id, ctx);
      return this.respond(args.id, args.content);
    }
    if (name === 'matrix_create_report') {
      this.scope(args.id, ctx);
      const file = await this.files.report(args.id, args.name, args.content, this.running?.run);
      this.changed();
      return { id: file.id, name: file.title, attached: true };
    }
    if (name === 'matrix_add_subtask') {
      this.scope(args.parent, ctx);
      const task = this.store.mutate({
        kind: 'matrix-task',
        parent: args.parent,
        title: args.title,
        data: { content: args.description ?? '', status: 'queued', enabled: true },
      });
      this.changed();
      return { id: task.id, queued: true };
    }
    throw new Error('Unknown Matrix tool');
  }
  attention(conversation, pending) {
    const task = this.store
      .all(false, true)
      .find((e) => e.kind === 'matrix-task' && e.data.conversation === conversation);
    if (!task) return;
    this.store.mutate({
      id: task.id,
      data: { status: pending ? 'needs_input' : 'running', awaitingApproval: pending },
    });
    this.changed();
  }
  start() {
    this.started = true;
    this.refresh();
  }
  stop(reason = 'Run paused by the user', state = 'paused') {
    if (!this.running) return;
    this.running.reason = reason;
    this.running.stopState = state;
    this.agent.stop(this.running.conversation);
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.preparation?.controller.abort();
    this.checking?.controller.abort();
    this.prepared.clear();
    this.triggers.close();
    this.store.off('changed', this.onChange);
    this.stop('Intelligence closed during this run. Review and retry when ready.', 'needs_input');
  }
  eligible(task) {
    if (!task || !this.runnable(task) || this.cooldownDeadline(task) > Date.now()) return false;
    if (
      task.data.schedule?.start &&
      task.data.approvedMissedStart !== task.data.schedule.start &&
      Date.now() - Date.parse(task.data.schedule.start) > 3600000 &&
      (task.data.trigger?.kind ?? 'time') === 'time'
    ) {
      const policy = this.store.settings().missedTaskPolicy;
      if (policy !== 'run') {
        const next = policy === 'skip' ? nextOccurrence(task.data.schedule) : null;
        this.store.mutate({
          id: task.id,
          data: {
            status: next ? 'queued' : policy === 'skip' ? 'done' : 'needs_input',
            result:
              policy === 'skip'
                ? 'Missed occurrence skipped by your scheduling policy.'
                : 'This starting time was missed. Review and run when ready.',
            verification: null,
            approvedMissedStart: null,
            lastAttemptAt: new Date().toISOString(),
            ...(next ? { schedule: { ...task.data.schedule, start: next } } : {}),
          },
        });
        return false;
      }
    }
    if (task.data.schedule?.start && Date.parse(task.data.schedule.start) > Date.now())
      return false;
    return this.runnable(task);
  }
  async tick() {
    if (this.running && !this.store.assigned(this.running.task))
      this.stop('Matrix integration was paused or access changed.');
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      return await this.dispatch();
    } finally {
      this.dispatching = false;
    }
  }
  async dispatch() {
    if (this.closed || this.store.settings().backgroundPaused) return;
    if (this.running) {
      const task = this.store.get(this.running.task),
        list = this.store.get(this.running.list);
      if (!task || !list?.data.integrated || !this.store.assigned(task.id))
        this.stop('Matrix integration was paused or access changed.');
      return;
    }
    if (this.agent.active.size) return;
    const lists = this.lists();
    const indices =
      this.store.settings().matrixScheduling === 'priority'
        ? [0, 1, 2]
        : [1, 2, 3].map((i) => (this.cursor + i) % 3);
    for (const index of indices) {
      const list = lists[index];
      if (!list?.data.integrated || list.data.attention) continue;
      const tasks = this.store.children(list.id, true).filter((e) => e.kind === 'matrix-task');
      for (const task of tasks.filter(
        (e) => (e.data.status ?? 'queued') === 'queued' && e.data.trigger?.kind === 'completion',
      )) {
        if (!this.store.access(task.data.trigger.source))
          this.triggerError(
            task.id,
            'The completion trigger source is unavailable or outside agent access.',
          );
      }
      for (const task of tasks.filter((e) => (e.data.status ?? 'queued') === 'queued')) {
        const blocked = this.store
          .children(task.id, true)
          .find(
            (e) =>
              e.kind === 'matrix-task' &&
              ['failed', 'needs_input', 'paused'].includes(e.data.status),
          );
        if (blocked)
          this.store.mutate({
            id: task.id,
            data: { status: 'needs_input', result: `Subtask “${blocked.title}” needs attention.` },
          });
      }
      const task = tasks.find((e) => this.eligible(this.store.get(e.id)));
      if (!task) continue;
      let profile;
      try {
        profile = this.profile(list);
      } catch (error) {
        this.triggerError(task.id, error.message);
        continue;
      }
      if (!profile.model || !this.store.settings().tools) {
        const message = profile.unavailableAgent
          ? 'The assigned agent is unavailable. Choose another agent.'
          : 'Choose a model for the assigned agent and enable agent tools in Settings, then resume this list.';
        this.store.mutate({ id: list.id, data: { attention: { task: task.id, message } } });
        this.store.mutate({
          id: task.id,
          data: {
            status: 'needs_input',
            result: message,
          },
        });
        this.changed();
        continue;
      }
      try {
        const key = this.preparationKey(task, list);
        this.checking = { task: task.id, list: list.id, key, controller: new AbortController() };
        const runtime = this.agent.providerRuntime?.(profile) ?? {};
        const loaded = await this.runtime.residentModel(
          profile,
          this.checking.controller.signal,
          runtime,
        );
        this.checking.controller.signal.throwIfAborted();
        if (!loaded && profile.matrixLoadedOnly)
          throw Error(
            'The selected chat model is not loaded. Matrix preloading is disabled; load it and retry.',
          );
        if (!loaded) await this.prepare(task, list);
        if (this.preparation?.controller.signal.aborted) return;
        const prepared = this.prepared.get(list.id);
        if (!loaded && prepared?.error) throw Error(prepared.error);
        if (
          this.closed ||
          this.agent.active.size ||
          !this.store.assigned(task.id) ||
          key !== this.preparationKey(this.store.get(task.id), this.store.get(list.id))
        )
          return;
        if (
          !loaded &&
          !providerInfo(profile.provider).cloud &&
          this.prepared.get(list.id)?.key !== this.preparationKey(task, list)
        )
          return;
      } catch (error) {
        if (
          !this.closed &&
          !this.checking?.controller.signal.aborted &&
          this.store.assigned(task.id)
        )
          this.unavailable(task, list, error.message);
        continue;
      } finally {
        this.checking = null;
      }
      this.cursor = index;
      this.prepared.delete(list.id);
      if (list.data.modelNotice) this.store.mutate({ id: list.id, data: { modelNotice: null } });
      return this.run(this.store.get(task.id), list, profile);
    }
    // Warm only the nearest eligible deadline. Do not load every integrated list at once.
    if (
      this.store.settings().matrixPreload &&
      this.store.settings().tools &&
      !this.agent.active.size
    ) {
      const now = Date.now(),
        lead = this.store.settings().matrixPreloadMinutes * 60000;
      const upcoming = this.tasks()
        .filter((task) => this.runnable(task) && Date.parse(task.data.schedule?.start) > now)
        .sort((a, b) => Date.parse(a.data.schedule.start) - Date.parse(b.data.schedule.start));
      const task = upcoming[0];
      if (task && Date.parse(task.data.schedule.start) - now <= lead) {
        const list = this.listFor(task.id),
          profile = this.profile(list);
        if (
          !providerInfo(profile.provider).cloud &&
          this.prepared.get(list.id)?.key !== this.preparationKey(task, list)
        )
          await this.prepare(task, list);
      }
    }
  }
  async run(task, list, inference = this.profile(list)) {
    const inbox = task.data.trigger?.mode === 'inbox';
    const batch = inbox ? this.triggers.inbox.claim(task) : [];
    if (inbox && !batch.length) {
      this.store.mutate({ id: task.id, data: { triggerPending: false } });
      return;
    }
    if (inbox) {
      this.store.mutate({ id: task.id, data: { watchBatch: batch } });
      task = this.store.get(task.id);
    }
    const conversation =
      this.store.get(task.data.conversation) ??
      this.store.mutate({
        kind: 'conversation',
        title: 'Matrix · ' + task.title,
        data: {
          matrixTask: task.id,
          context: [task.id],
          memoryExcluded: true,
          agentProfile: inference.profileId,
        },
        project: null,
      });
    const run = randomUUID();
    if (inference.profileId && conversation.data.agentProfile !== inference.profileId)
      this.store.mutate({ id: conversation.id, data: { agentProfile: inference.profileId } });
    this.running = { task: task.id, list: list.id, conversation: conversation.id, run };
    this.store.mutate({
      id: task.id,
      data: {
        status: 'running',
        conversation: conversation.id,
        startedAt: new Date().toISOString(),
        awaitingApproval: false,
        triggerPending: false,
        lastAgent: inference.profileId,
        lastModel: inference.model,
        lastProvider: inference.provider,
        ...(task.data.trigger?.kind === 'completion'
          ? { lastTriggeredAt: new Date().toISOString() }
          : {}),
        lastTriggerToken:
          task.data.trigger?.kind === 'completion'
            ? completionToken(this.store.get(task.data.trigger.source))
            : (task.data.lastTriggerToken ?? null),
      },
    });
    this.store.db
      .prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)')
      .run(run, task.id, 'running', new Date().toISOString(), null, null, conversation.id);
    this.store.db
      .prepare('INSERT INTO run_profiles VALUES(?,?,?,?,?)')
      .run(
        run,
        inference.profileId || null,
        inference.agentName || 'Intelligence',
        inference.provider || null,
        inference.model || null,
      );
    this.changed();
    const firstMessage = this.store.messages(conversation.id).length;
    const firstResponses = this.store
      .children(task.id)
      .filter((e) => e.kind === 'matrix-entry').length;
    const timer = setTimeout(
      () =>
        this.stop(
          'The task reached its execution time budget. Review progress and retry if needed.',
          'needs_input',
        ),
      this.store.settings().matrixMaxMinutes * 60000,
    );
    try {
      await this.agent.chat({
        inference,
        conversation: conversation.id,
        task: task.id,
        context: [task.id],
        text: `Execute this integrated Cognition Matrix task. Read the full task and attachments with Matrix tools, work on the requested deliverable, and record matrix_outcome.\n${JSON.stringify(this.taskData(task.id))}`,
      });
      const answer = this.store
        .messages(conversation.id)
        .slice(firstMessage)
        .filter((m) => m.role === 'assistant' && !m.data.tool && !m.data.error)
        .at(-1);
      if (
        answer?.content &&
        this.store.children(task.id).filter((e) => e.kind === 'matrix-entry').length ===
          firstResponses
      )
        this.respond(task.id, answer.content.slice(0, 100000));
      const current = this.store.get(task.id);
      if (this.running.reason)
        this.store.mutate({
          id: task.id,
          data: {
            status: this.running.stopState,
            result: this.running.reason,
            awaitingApproval: false,
          },
        });
      else if (current && ['running', 'queued'].includes(current.data.status)) {
        const newSubtasks = this.store
          .children(task.id, true)
          .filter((e) => e.kind === 'matrix-task');
        this.store.mutate({
          id: task.id,
          data: newSubtasks.some((e) => e.data.status === 'queued')
            ? {
                status: 'queued',
                triggerPending: true,
                result: 'Subtasks queued; this task resumes after they finish.',
              }
            : {
                status: 'needs_input',
                result: answer?.content
                  ? 'Review the response. The agent did not record a verified outcome.'
                  : 'The model returned no outcome. Review the conversation and retry.',
              },
        });
      }
    } catch (error) {
      if (this.store.get(task.id))
        this.store.mutate({
          id: task.id,
          data: {
            status: this.running.stopState ?? 'failed',
            result: this.running.reason ?? error.message,
            awaitingApproval: false,
          },
        });
    } finally {
      clearTimeout(timer);
      const completed = this.store.get(task.id);
      if (inbox && completed) this.triggers.inbox.finish(completed, run);
      if (
        completed?.data.status === 'done' &&
        completed.data.schedule?.repeat &&
        completed.data.schedule.repeat !== 'none'
      ) {
        const start = nextOccurrence(completed.data.schedule);
        if (start)
          this.store.mutate({
            id: task.id,
            data: {
              status: 'queued',
              schedule: { ...completed.data.schedule, start },
              startedAt: null,
              lastCompletedAt: completed.data.completedAt,
            },
          });
      }
      const current = this.store.get(task.id);
      this.store.db
        .prepare('UPDATE runs SET status=?,end=?,result=? WHERE id=?')
        .run(
          current?.data.status ?? 'needs_input',
          new Date().toISOString(),
          current?.data.result ?? '',
          run,
        );
      this.running = null;
      this.suppressFilesUntil = Date.now() + 1000;
      this.changed();
      this.refresh();
    }
  }
}
