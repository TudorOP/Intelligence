import moduleCatalog from '../electron/module-catalog.json';
import type { API, Entity, Snapshot, Settings } from './types';
const listeners = new Set<(e: any) => void>();
const emit = (e: any) => listeners.forEach((fn) => fn(e));
let cache: Snapshot | null = null;
async function state() {
  if (cache) return cache;
  const saved = localStorage.getItem('intelligence-preview');
  cache = saved ? JSON.parse(saved) : await (await fetch('./browser-seed.json')).json();
  return cache!;
}
async function save() {
  localStorage.setItem('intelligence-preview', JSON.stringify(await state()));
  emit({ type: 'changed' });
}
const desktopOnly = async () => {
  throw new Error(
    'Open the Electron app to use system tools and local model inference. This browser preview supports the workspace interface.',
  );
};
const preview: API = {
  async workspace(input) {
    const s = await state();
    if (input.action === 'module-status')
      return {
        supported: false,
        modules: moduleCatalog.modules
          .filter((m) => m.id !== 'kokoro')
          .map((logical) => {
            const c = s.settings.optionalModules?.[logical.id] || {},
              engineId = logical.id === 'tts' && c.engine === 'kokoro' ? 'kokoro' : logical.id,
              m = moduleCatalog.modules.find((item) => item.id === engineId)!,
              model = m.id === 'stt' && c.recognitionModel === 'larger' ? m.models?.[0] : m.model;
            return {
              ...m,
              id: logical.id,
              engineId,
              name: logical.id === 'tts' ? 'Text to speech · English only' : m.name,
              engines:
                logical.id === 'tts'
                  ? [
                      { id: 'tts', name: 'Piper', hasData: false },
                      { id: 'kokoro', name: 'Kokoro-82M', hasData: false },
                    ]
                  : undefined,
              configuration: c,
              enabled: !!c.enabled,
              installed: false,
              hasData: false,
              modelReady: false,
              state: { status: 'not-installed' },
              model: model
                ? { ...model, bytes: model.files.reduce((n, f) => n + f.bytes, 0) }
                : undefined,
            };
          }),
      };
    if (input.action === 'module-configure') {
      await preview.settings({
        optionalModules: {
          ...s.settings.optionalModules,
          [input.id]: { ...s.settings.optionalModules?.[input.id], ...input.configuration },
        },
      });
      return preview.workspace({ action: 'module-status' });
    }
    if (input.action.startsWith('module-')) return desktopOnly();
    const profiles = s.entities.filter((e) => e.kind === 'agent-profile' && !e.deleted);
    if (input.action === 'profile-save')
      return preview.mutate({
        id: input.id,
        kind: 'agent-profile',
        title: input.title,
        data: {
          ...input.data,
          performance:
            ['intelligence', 'knowledge', 'toolUse', 'longTasks'].reduce(
              (n, key) => n + (input.data.ratings?.[key] ?? 0),
              0,
            ) / 4,
        },
      });
    if (input.action === 'profile-list') return profiles;
    if (input.action === 'profile-select') {
      await preview.settings({ activeAgent: input.id });
      return profiles.find((e) => e.id === input.id);
    }
    if (input.action === 'profile-delete') {
      if (profiles.length < 2) throw Error('Keep at least one agent profile');
      return preview.mutate({ id: input.id, action: 'trash' });
    }
    if (input.action === 'pause') return preview.settings({ backgroundPaused: input.paused });
    if (input.action === 'visit')
      return preview.settings({
        recentItems: [
          { id: input.id, at: Date.now() },
          ...(s.settings.recentItems ?? []).filter((v) => v.id !== input.id),
        ].slice(0, 100),
      });
    if (input.action === 'pin')
      return preview.settings({
        pinnedItems: [
          ...(s.settings.pinnedItems ?? []).filter((v) => v !== input.id),
          ...(input.enabled ? [input.id] : []),
        ].slice(0, 40),
      });
    if (input.action === 'activity' || input.action === 'history') return [];
    return desktopOnly();
  },
  copy: async (text) => navigator.clipboard.writeText(text),
  compact: desktopOnly,
  chatInfo: async () => ({ capacity: 8192, capacitySource: 'fallback', used: 0, estimated: true }),
  inferenceKey: desktopOnly,
  vault: desktopOnly,
  async bootstrap() {
    const s = await state();
    for (const key of ['animatedBackground', 'animationOpacity', 'backgroundMotionPaused'])
      delete (s.settings as any)[key];
    if (!s.entities.some((e) => e.kind === 'agent-profile' && !e.deleted)) {
      const id = crypto.randomUUID(),
        at = new Date().toISOString();
      s.entities.push({
        id,
        kind: 'agent-profile',
        title: s.settings.agentName,
        data: {
          avatar: s.settings.avatar,
          personality: s.settings.personality,
          systemPrompt: s.settings.systemPrompt,
          provider: s.settings.provider,
          model: s.settings.model,
          inheritModel: true,
          ratings: {},
          performance: 0,
        },
        parent: null,
        project: null,
        revision: 1,
        created: at,
        updated: at,
        deleted: false,
      });
      s.settings.activeAgent = id;
    }
    let initialized = false;
    for (const [slot, title] of [
      ['core', 'Core'],
      ['secondary', 'Secondary'],
      ['tertiary', 'Tertiary'],
    ]) {
      if (!s.entities.some((e) => e.id === 'matrix-' + slot)) {
        const time = new Date().toISOString();
        s.entities.push({
          id: 'matrix-' + slot,
          kind: 'matrix-list',
          title,
          parent: null,
          project: null,
          data: { slot, description: '', integrated: false, access: true, permission: 'edit' },
          revision: 1,
          created: time,
          updated: time,
          deleted: false,
        });
        initialized = true;
      }
    }
    if (initialized) localStorage.setItem('intelligence-preview', JSON.stringify(s));
    const machine = await fetch('/api/machine')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    return {
      ...(await state()),
      entities: s.entities.map((entity) => {
        if (entity.kind !== 'card') return entity;
        let current: Entity | undefined = entity,
          access: boolean | null = null,
          permission: string | null = null,
          assigned: boolean | null = null;
        const seen = new Set<string>();
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          if (access === null && typeof current.data.access === 'boolean')
            access = current.data.access;
          if (permission === null && current.data.permission) permission = current.data.permission;
          if (assigned === null && typeof current.data.assigned === 'boolean')
            assigned = current.data.assigned;
          current = s.entities.find((item) => item.id === current?.parent);
        }
        const allowed = s.settings.kanbanAccess !== false && access === true;
        return {
          ...entity,
          agentAccess: allowed,
          agentEditable: allowed && permission !== 'read',
          agentAssigned: allowed && permission !== 'read' && assigned === true,
        };
      }),
      settings: {
        ...(await state()).settings,
        autoReadAloud: s.settings.autoReadAloud ?? false,
        paneWidths: s.settings.paneWidths ?? { sidebar: 238, navigator: 265, assistant: 390 },
        notebookLook: s.settings.notebookLook ?? 'bound',
        decorativeBackgrounds: s.settings.decorativeBackgrounds ?? true,
        backgroundArtwork: s.settings.backgroundArtwork ?? 'theme',
        backgroundImage: s.settings.backgroundImage ?? '',
        backgroundOpacity: s.settings.backgroundOpacity ?? 7,
        backgroundBlur: s.settings.backgroundBlur ?? 0,
        pinnedItems: s.settings.pinnedItems ?? [],
        recentItems: s.settings.recentItems ?? [],
        backgroundPaused: s.settings.backgroundPaused ?? false,
        layout: 'studio',
        skillsView: s.settings.skillsView ?? 'cards',
        appIcon: s.settings.appIcon ?? 'original',
        trayIcon: s.settings.trayIcon ?? 'original',
        logoIcon: s.settings.logoIcon ?? 'original',
        toolRepair: s.settings.toolRepair ?? true,
        toolRepairAttempts: s.settings.toolRepairAttempts ?? 2,
        toolStepLimit: s.settings.toolStepLimit ?? 12,
        connectedProviders: s.settings.connectedProviders ?? [s.settings.provider],
        semanticSearch: (await state()).settings.semanticSearch ?? true,
        autoConsolidation: (await state()).settings.autoConsolidation ?? true,
        matrixAccess: s.settings.matrixAccess ?? true,
        matrixShowCompleted: s.settings.matrixShowCompleted ?? true,
        matrixCompactRows: s.settings.matrixCompactRows ?? false,
        matrixPollSeconds: s.settings.matrixPollSeconds ?? 1,
        matrixPreload: s.settings.matrixPreload ?? true,
        matrixPreloadMinutes: s.settings.matrixPreloadMinutes ?? 5,
        matrixMaxMinutes: s.settings.matrixMaxMinutes ?? 30,
        matrixMaxSteps: s.settings.matrixMaxSteps ?? 48,
        matrixScheduling: s.settings.matrixScheduling ?? 'round-robin',
        matrixWorkingColor: s.settings.matrixWorkingColor ?? '#81a6d4',
        matrixDoneColor: s.settings.matrixDoneColor ?? '#71b68b',
        matrixFailedColor: s.settings.matrixFailedColor ?? '#d47777',
        matrixAttentionColor: s.settings.matrixAttentionColor ?? '#d6af68',
        matrixQueuedColor: s.settings.matrixQueuedColor ?? '#89958f',
        searxngEndpoint: s.settings.searxngEndpoint ?? '',
        searchEnabled: s.settings.searchEnabled ?? true,
        profileDescription: s.settings.profileDescription ?? '',
        profilePhoto: s.settings.profilePhoto ?? '',
        shareProfile: s.settings.shareProfile ?? false,
        optionalModules: s.settings.optionalModules ?? {},
        searchProvider: s.settings.searchProvider ?? 'searxng',
        searchMaxResults: s.settings.searchMaxResults ?? 10,
        searchTimeoutSeconds: s.settings.searchTimeoutSeconds ?? 15,
      },
      desktop: false,
      memoryStatus: 'Browser preview · CPU search runs in the Linux app',
      consolidationStatus: 'MiniCPM5 consolidation runs in the Linux app',
      machine: machine ?? undefined,
    };
  },
  async mutate(input) {
    const s = await state();
    const old = s.entities.find((e) => e.id === input.id);
    if (input.action === 'reorder') {
      if (
        !old ||
        old.deleted ||
        !['card', 'list'].includes(old.kind) ||
        old.revision !== input.revision
      )
        throw new Error('This item changed. Reload it before moving.');
      const parent = input.parent ?? old.parent;
      const target = s.entities.find((e) => e.id === parent && !e.deleted);
      const source = s.entities.find((e) => e.id === old.parent && !e.deleted);
      if (old.kind === 'list' && (parent !== old.parent || target?.kind !== 'board'))
        throw new Error('Reorder lists within the current board');
      if (old.kind === 'card' && (target?.kind !== 'list' || target.parent !== source?.parent))
        throw new Error('Choose a list in this board');
      const ordered = s.entities
        .filter((e) => !e.deleted && e.kind === old.kind && e.parent === parent && e.id !== old.id)
        .sort(
          (a, b) =>
            (a.data.order ?? Date.parse(a.created)) - (b.data.order ?? Date.parse(b.created)),
        );
      const at =
        input.beforeId == null ? ordered.length : ordered.findIndex((e) => e.id === input.beforeId);
      if (at < 0 || (input.beforeId != null && ordered[at].revision !== input.beforeRevision))
        throw new Error('The destination changed. Try moving again.');
      ordered.splice(at, 0, old);
      ordered.forEach((e, i) => {
        if (e.parent !== parent || e.data.order !== i * 1024) {
          e.parent = parent;
          e.data.order = i * 1024;
          e.revision++;
          e.updated = new Date().toISOString();
        }
      });
      await save();
      return old;
    }
    if (old?.kind === 'matrix-list' && input.action && input.action !== 'save')
      throw new Error('The three Matrix lists are permanent');
    if (old?.id === 'matrix-core' && input.title !== undefined && input.title !== 'Core')
      throw new Error('Core keeps its name');
    if (!old && input.kind === 'matrix-list')
      throw new Error('Cognition Matrix has exactly three lists');
    if (input.action === 'trash' || input.action === 'restore') {
      const update = (id: string) => {
        s.entities
          .filter((e) => e.id === id || e.parent === id)
          .forEach((e) => {
            e.deleted = input.action === 'trash';
            s.entities.filter((c) => c.parent === e.id).forEach((c) => update(c.id));
          });
      };
      if (old) update(old.id);
      await save();
      return old!;
    }
    const time = new Date().toISOString();
    const value: Entity = {
      id: old?.id ?? crypto.randomUUID(),
      kind: old?.kind ?? input.kind,
      title: input.title ?? old?.title ?? 'Untitled',
      parent: input.parent !== undefined ? input.parent : (old?.parent ?? null),
      project: (old?.kind ?? input.kind)?.startsWith('matrix-')
        ? null
        : (input.project ?? old?.project ?? null),
      data: { ...old?.data, ...input.data },
      revision: (old?.revision ?? 0) + 1,
      created: old?.created ?? time,
      updated: time,
      deleted: false,
    };
    if (old) s.entities[s.entities.indexOf(old)] = value;
    else s.entities.push(value);
    await save();
    return value;
  },
  async settings(input) {
    const s = await state();
    if (input.theme && input.theme !== 'night') input = { ...input, returnTheme: input.theme };
    s.settings = { ...s.settings, ...input };
    await save();
    return s.settings;
  },
  async messages() {
    return [];
  },
  async history() {
    return [];
  },
  async search(q) {
    return (await state()).entities.filter(
      (e) =>
        !e.deleted &&
        (e.title + ' ' + (e.data.content ?? '')).toLowerCase().includes(q.toLowerCase()),
    );
  },
  models: desktopOnly,
  chat: desktopOnly,
  stop: desktopOnly,
  approve: desktopOnly,
  async image() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
  export: desktopOnly,
  directory: desktopOnly,
  project: desktopOnly,
  async system() {
    const response = await fetch('/api/system');
    if (!response.ok) throw new Error('Machine inspection is unavailable in this preview');
    return response.json();
  },
  async containers() {
    const response = await fetch('/api/containers');
    if (!response.ok) throw new Error('Container inspection is unavailable');
    return response.json();
  },
  async logs(options) {
    const query = new URLSearchParams(
      Object.entries(options)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    );
    const response = await fetch('/api/logs?' + query);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Logs could not be read');
    return result;
  },
  async prepareMachine() {
    const report = await preview.system();
    const existing = (await state()).entities.find((e) => e.kind === 'machine' && !e.deleted);
    return preview.mutate({
      id: existing?.id,
      kind: 'machine',
      title: report.displayName,
      data: {
        access: true,
        permission: 'read',
        ready: true,
        readOnly: true,
        snapshot: report,
        content: '# Read-only machine profile\n\n' + JSON.stringify(report, null, 2),
      },
    });
  },
  memoryEnable: desktopOnly,
  memoryResolve: desktopOnly,
  async memoryInspect(id) {
    const s = await state(),
      memory = s.entities.find((e) => e.id === id && !e.deleted);
    if (memory?.kind !== 'memory') throw new Error('Memory no longer exists');
    return {
      available: false,
      reason: 'Open the desktop app to inspect live memory access',
      sources: (memory.data.sources ?? []).slice(0, 40).map((source: string) => {
        const e = s.entities.find((item) => item.id === source);
        return {
          id: source,
          title: e?.title ?? '',
          kind: e?.kind ?? '',
          deleted: !e || e.deleted,
          available: false,
        };
      }),
      messageCount: 0,
      messages: [],
    };
  },
  async memorySearch(q, options) {
    return (await preview.search(q)).filter((e) =>
      options?.memoriesOnly ? e.kind === 'memory' : ['memory', 'note'].includes(e.kind),
    );
  },
  connect: desktopOnly,
  disconnect: desktopOnly,
  window: desktopOnly,
  runTask: desktopOnly,
  stopTask: desktopOnly,
  async trash() {
    return (await state()).entities.filter((e) => e.deleted);
  },
  async deleteTrash(id) {
    if (Array.isArray(id)) {
      const deleted: string[] = [],
        failed: { id: string; error: string }[] = [];
      for (const target of id) {
        if (!(await state()).entities.some((e) => e.id === target)) continue;
        try {
          deleted.push(...(await preview.deleteTrash(target)).deleted);
        } catch (e) {
          failed.push({ id: target, error: (e as Error).message });
        }
      }
      return { deleted, failed };
    }
    const s = await state();
    const item = s.entities.find((e) => e.id === id);
    if (!item?.deleted) throw new Error('Choose an item in Trash');
    const ids = new Set([id]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const e of s.entities) {
        if (
          !ids.has(e.id) &&
          ((e.parent && ids.has(e.parent)) ||
            (e.kind === 'memory' &&
              e.data.auto &&
              (e.data.sources ?? []).some((source: string) => ids.has(source))))
        ) {
          if (!e.deleted && e.kind !== 'memory')
            throw new Error('All contained items must be in Trash');
          ids.add(e.id);
          expanded = true;
        }
      }
    }
    s.entities = s.entities.filter((e) => !ids.has(e.id));
    s.runs = s.runs.filter((run) => !ids.has(run.card) && !ids.has(run.conversation));
    await save();
    return { deleted: [...ids] };
  },
  async completeTask(id) {
    return preview.mutate({ id, data: { status: 'done', assigned: false } });
  },
  async matrixAction({ action, id, content }) {
    const s = await state(),
      task = s.entities.find((e) => e.id === id && !e.deleted);
    if (!task) throw new Error('Matrix task not found');
    if (action === 'conversation') throw new Error('Open the desktop app for task conversations');
    if (action === 'reply')
      await preview.mutate({
        kind: 'matrix-entry',
        parent: id,
        title: 'Your response',
        data: { role: 'user', content },
      });
    if (action === 'clear-attention') return preview.mutate({ id, data: { attention: null } });
    return preview.mutate({
      id,
      data: {
        status: action === 'pause' ? 'paused' : action === 'complete' ? 'done' : 'queued',
        enabled: true,
      },
    });
  },
  matrixAttach: desktopOnly,
  matrixOpenFile: desktopOnly,
  matrixExportFile: desktopOnly,
  searchProvider: desktopOnly,
  onEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
export const api: API = window.intelligence ?? preview;
export function allowed(entity: Entity, entities: Entity[], settings: Settings, edit = false) {
  if (entity.kind === 'machine') return !edit && entity.data.access === true;
  const section = ['board', 'list', 'card'].includes(entity.kind)
    ? settings.kanbanAccess
    : entity.kind.startsWith('vault-')
      ? settings.vaultAccess !== false
      : entity.kind.startsWith('matrix-')
        ? settings.matrixAccess
        : settings.notebookAccess;
  if (!section) return false;
  let e: Entity | undefined = entity,
    access: boolean | null = null,
    permission: string | null = null;
  while (e) {
    if (access === null && typeof e.data.access === 'boolean') access = e.data.access;
    if (permission === null && e.data.permission) permission = e.data.permission;
    e = entities.find((p) => p.id === e?.parent);
  }
  return access === true && (!edit || permission !== 'read');
}
export function art(cover?: string) {
  return cover?.startsWith('intelligence-media:') || cover?.startsWith('data:')
    ? cover
    : cover === 'night'
      ? './assets/night-ribbon.png'
      : './assets/day-ink.png';
}
export const icons = [
  '✳',
  '⌘',
  '☼',
  '◈',
  '↗',
  '✦',
  '❋',
  '◎',
  '☁',
  '☷',
  '◌',
  '✎',
  '🌿',
  '📓',
  '🪐',
  '💡',
  '🧭',
  '🌙',
  '🔬',
  '🎨',
];
