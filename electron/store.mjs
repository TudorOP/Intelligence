import { DatabaseSync } from 'node:sqlite';
import { validateAppearanceSettings, themeIds } from './appearance-settings.mjs';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { validateMatrixProfile, validateMatrixTrigger } from './matrix-config.mjs';
import { nextOccurrence } from './schedule.mjs';
import { searchProviderIds } from './search-providers.mjs';
import {
  inferenceProviders,
  providerInfo,
  validateInferenceAddress,
} from './inference-providers.mjs';
import { validateEvent, validateReportTemplate } from './planning-schema.mjs';
import { redactLog } from './workloads.mjs';

export const kinds = [
  'machine',
  'notebook',
  'chapter',
  'note',
  'board',
  'list',
  'card',
  'project',
  'memory',
  'skill',
  'connection',
  'conversation',
  'agent-profile',
  'calendar',
  'calendar-event',
  'report-template',
  'report',
  'matrix-list',
  'matrix-task',
  'matrix-file',
  'matrix-entry',
  'vault-folder',
  'vault-file',
];
export const defaults = {
  theme: 'night',
  returnTheme: 'day',
  chatWidth: 'comfortable',
  followLatest: true,
  showThinking: false,
  autoReadAloud: false,
  approvalMode: 'ask',
  autoCompact: true,
  compactPercent: 75,
  contextOverride: 0,
  language: 'en',
  visionEnabled: true,
  apiMaxTokens: 8192,
  providerProfiles: {},
  vaultAccess: true,
  vaultFont: 'inter',
  vaultSort: 'manual',
  activeAgent: '',
  backgroundPaused: false,
  activityNotifications: false,
  notebookLook: 'bound',
  decorativeBackgrounds: true,
  backgroundArtwork: 'theme',
  backgroundImage: '',
  backgroundOpacity: 7,
  backgroundBlur: 0,
  paneWidths: { sidebar: 238, navigator: 265, assistant: 390 },
  pinnedItems: [],
  recentItems: [],
  onboardingComplete: false,
  missedTaskPolicy: 'ask',
  externalEventsEnabled: false,
  externalEventsPort: 30091,
  wakeForTasks: false,
  preferredName: '',
  profileDescription: '',
  profilePhoto: '',
  shareProfile: false,
  optionalModules: {
    tts: { engine: 'kokoro', localVoice: 'af_heart', enabled: false },
    stt: { recognitionModel: 'larger', enabled: false },
  },
  shareName: true,
  calendarAccess: true,
  reportsAccess: true,
  reportsAutomation: false,
  reportAnimations: true,
  reportImages: false,
  reportPresentation: 'notify',
  calendarMode: 'combined',
  calendarView: 'week',
  calendarProfiles: [],
  calendarLayers: ['tasks', 'matrix', 'reports', 'execution', 'events'],
  layout: 'studio',
  skillsView: 'cards',
  skillLearning: 'automatic',
  appIcon: 'original',
  trayIcon: 'original',
  logoIcon: 'original',
  toolRepair: true,
  toolRepairAttempts: 2,
  toolStepLimit: 12,
  connectedProviders: [],
  agentName: 'Intelligence',
  avatar: '',
  accent: '#a9c4b4',
  personality:
    'You are a thoughtful, practical companion. Explain clearly, stay curious, and help the user learn at their own pace.',
  systemPrompt:
    'Help the user accomplish their request with available tools. Verify the outcome of actions. Be honest about uncertainty and tool limitations.',
  provider: 'ollama',
  endpoint: 'http://127.0.0.1:11434',
  model: '',
  tools: true,
  notebookAccess: true,
  kanbanAccess: true,
  memoryAccess: true,
  terminalAccess: false,
  background: false,
  embeddingEnabled: false,
  semanticSearch: true,
  autoConsolidation: true,
  matrixAccess: true,
  matrixShowCompleted: true,
  matrixCompactRows: false,
  matrixPollSeconds: 1,
  matrixPreload: true,
  matrixPreloadMinutes: 5,
  matrixMaxMinutes: 30,
  matrixMaxSteps: 48,
  matrixScheduling: 'round-robin',
  matrixWorkingColor: '#81a6d4',
  matrixDoneColor: '#71b68b',
  matrixFailedColor: '#d47777',
  matrixAttentionColor: '#d6af68',
  matrixQueuedColor: '#89958f',
  searxngEndpoint: '',
  searchEnabled: true,
  searchProvider: 'searxng',
  searchMaxResults: 10,
  searchTimeoutSeconds: 15,
};
const parentKinds = {
  'calendar-event': ['calendar'],
  chapter: ['notebook'],
  note: ['notebook', 'chapter'],
  list: ['board'],
  card: ['list'],
  'matrix-task': ['matrix-list', 'matrix-task'],
  'matrix-file': ['matrix-task'],
  'matrix-entry': ['matrix-task'],
  'vault-folder': ['vault-folder'],
  'vault-file': ['vault-folder'],
};
const now = () => new Date().toISOString();
export class Store extends EventEmitter {
  constructor(directory) {
    super();
    fs.mkdirSync(directory, { recursive: true });
    this.directory = directory;
    this.db = new DatabaseSync(path.join(directory, 'intelligence.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY,kind TEXT NOT NULL,parent TEXT,project TEXT,title TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entity_parent ON entities(parent);
      CREATE INDEX IF NOT EXISTS entity_kind ON entities(kind,deleted);
      CREATE TABLE IF NOT EXISTS versions (id TEXT,revision INTEGER,data TEXT,updated TEXT,PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY,conversation TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY,revision INTEGER,model TEXT,vector TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,title,content);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,card TEXT,status TEXT,start TEXT,end TEXT,result TEXT,conversation TEXT);
      CREATE TABLE IF NOT EXISTS consolidation (conversation TEXT PRIMARY KEY,cursor TEXT,updated TEXT);
      CREATE TABLE IF NOT EXISTS memory_tombstones (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS search_credentials (provider TEXT PRIMARY KEY,value BLOB NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(id UNINDEXED,conversation UNINDEXED,content);
    `);
    this.db.exec(`INSERT INTO message_search SELECT id,conversation,content FROM messages
      WHERE role IN ('user','assistant') AND coalesce(json_extract(data,'$.tool'),0)=0
      AND coalesce(json_extract(data,'$.error'),0)=0 AND id NOT IN (SELECT id FROM message_search)`);
    this.firstRun = !this.db.prepare('SELECT 1 FROM settings WHERE key=?').get('initialized');
    if (this.firstRun) this.seed();
    for (const [slot, title] of [
      ['core', 'Core'],
      ['secondary', 'Secondary'],
      ['tertiary', 'Tertiary'],
    ]) {
      const id = 'matrix-' + slot;
      if (!this.get(id, true))
        this.mutate({
          id: undefined,
          kind: 'matrix-list',
          title,
          data: { slot, integrated: false, access: true, permission: 'edit', description: '' },
          matrixId: id,
        });
    }
  }
  settings() {
    const rows = this.db.prepare('SELECT key,value FROM settings').all();
    const settings = {
      ...defaults,
      ...Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])),
      layout: 'studio',
    };
    // Keep old database rows recoverable, but never expose retired motion settings.
    for (const key of ['animatedBackground', 'animationOpacity', 'backgroundMotionPaused'])
      delete settings[key];
    if (!rows.some((r) => r.key === 'connectedProviders'))
      settings.connectedProviders = [
        ...new Set([settings.provider, ...Object.keys(settings.providerProfiles)]),
      ];
    return settings;
  }
  setSettings(value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid settings');
    validateAppearanceSettings(value);
    if (value.autoReadAloud !== undefined && typeof value.autoReadAloud !== 'boolean')
      throw Error('Invalid automatic reading preference');
    validateOptionalModules(value.optionalModules);
    if (
      value.profileDescription !== undefined &&
      (typeof value.profileDescription !== 'string' || value.profileDescription.length > 2000)
    )
      throw Error('Use a profile description of at most 2000 characters');
    if (value.shareProfile !== undefined && typeof value.shareProfile !== 'boolean')
      throw Error('Invalid profile sharing preference');
    if (
      value.profilePhoto !== undefined &&
      (typeof value.profilePhoto !== 'string' ||
        (value.profilePhoto &&
          !/^intelligence-media:\/\/asset\/[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(
            value.profilePhoto,
          )))
    )
      throw Error('Choose an imported profile photo');
    if (
      value.skillLearning !== undefined &&
      !['automatic', 'review', 'off'].includes(value.skillLearning)
    )
      throw Error('Invalid skill learning mode');
    if (
      value.preferredName !== undefined &&
      (typeof value.preferredName !== 'string' || value.preferredName.trim().length > 100)
    )
      throw Error('Use a name of at most 100 characters');
    if (
      value.calendarMode !== undefined &&
      !['personal', 'combined', 'agent'].includes(value.calendarMode)
    )
      throw Error('Invalid calendar mode');
    if (
      value.calendarView !== undefined &&
      !['agenda', 'week', 'month'].includes(value.calendarView)
    )
      throw Error('Invalid calendar view');
    if (
      value.reportPresentation !== undefined &&
      !['quiet', 'notify', 'present'].includes(value.reportPresentation)
    )
      throw Error('Invalid report delivery');
    for (const key of ['calendarProfiles', 'calendarLayers'])
      if (
        value[key] !== undefined &&
        (!Array.isArray(value[key]) ||
          value[key].length > 40 ||
          value[key].some((v) => typeof v !== 'string'))
      )
        throw Error('Invalid calendar filter');
    if (
      value.externalEventsPort !== undefined &&
      (!Number.isInteger(value.externalEventsPort) ||
        value.externalEventsPort < 1024 ||
        value.externalEventsPort > 65535)
    )
      throw Error('Choose an event port between 1024 and 65535');
    if (
      value.notebookLook !== undefined &&
      !['bound', 'paperback', 'spiral', 'index', 'folio'].includes(value.notebookLook)
    )
      throw Error('Invalid notebook look');
    if (
      value.missedTaskPolicy !== undefined &&
      !['ask', 'skip', 'run'].includes(value.missedTaskPolicy)
    )
      throw Error('Invalid missed-task policy');
    if (
      value.paneWidths &&
      Object.entries(value.paneWidths).some(
        ([k, v]) =>
          !['sidebar', 'navigator', 'assistant'].includes(k) ||
          !Number.isFinite(v) ||
          v < 180 ||
          v > 650,
      )
    )
      throw Error('Invalid pane width');
    if (
      value.pinnedItems &&
      (!Array.isArray(value.pinnedItems) ||
        value.pinnedItems.length > 40 ||
        value.pinnedItems.some((v) => typeof v !== 'string'))
    )
      throw Error('Invalid pinned items');
    if (
      value.recentItems &&
      (!Array.isArray(value.recentItems) ||
        value.recentItems.length > 100 ||
        value.recentItems.some((v) => typeof v.id !== 'string' || !Number.isFinite(v.at)))
    )
      throw Error('Invalid recent items');
    if (
      value.vaultSort !== undefined &&
      !['manual', 'name', 'name-desc', 'updated', 'folders'].includes(value.vaultSort)
    )
      throw new Error('Invalid Vault sort order');
    const clean = {};
    for (const [k, v] of Object.entries(value))
      if (k in defaults) {
        if (typeof v !== typeof defaults[k]) throw new Error(`Invalid ${k}`);
        if (typeof v === 'string' && v.length > (k === 'personality' ? 50000 : 20000))
          throw new Error('Setting is too long');
        clean[k] = v;
      }
    if (clean.preferredName !== undefined) clean.preferredName = clean.preferredName.trim();
    if (clean.endpoint) {
      const u = new URL(clean.endpoint);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        throw new Error('Use an HTTP endpoint without embedded credentials');
      clean.endpoint = u.origin + u.pathname.replace(/\/$/, '');
    }
    if (
      clean.theme &&
      ![...themeIds, 'system'].includes(clean.theme)
    )
      throw new Error('Invalid theme');
    if (
      clean.returnTheme &&
      ![...themeIds.filter((id) => id !== 'night'), 'system'].includes(clean.returnTheme)
    )
      throw new Error('Invalid return theme');
    if (clean.theme && clean.theme !== 'night') clean.returnTheme = clean.theme;
    if (clean.layout && !['studio', 'compact', 'reading'].includes(clean.layout))
      throw new Error('Invalid layout');
    if (clean.layout !== undefined) clean.layout = 'studio';
    if (clean.skillsView && !['cards', 'list'].includes(clean.skillsView))
      throw Error('Invalid Skills view');
    if (clean.chatWidth && !['comfortable', 'wide'].includes(clean.chatWidth))
      throw new Error('Invalid chat width');
    if (clean.approvalMode && !['ask', 'auto', 'full'].includes(clean.approvalMode))
      throw new Error('Invalid approval mode');
    if (['auto', 'full'].includes(clean.approvalMode) && clean.terminalAccess === undefined)
      clean.terminalAccess = true;
    if (
      clean.compactPercent !== undefined &&
      (!Number.isInteger(clean.compactPercent) ||
        clean.compactPercent < 25 ||
        clean.compactPercent > 95)
    )
      throw new Error('Compaction threshold must be from 25 to 95 percent');
    if (
      clean.contextOverride !== undefined &&
      (!Number.isInteger(clean.contextOverride) ||
        clean.contextOverride < 0 ||
        clean.contextOverride > 2000000)
    )
      throw new Error('Invalid context capacity');
    for (const key of ['appIcon', 'trayIcon', 'logoIcon'])
      if (clean[key] !== undefined && !['original', 'prism', 'aurora'].includes(clean[key]))
        throw new Error('Invalid icon');
    if (
      clean.toolRepairAttempts !== undefined &&
      (!Number.isInteger(clean.toolRepairAttempts) ||
        clean.toolRepairAttempts < 0 ||
        clean.toolRepairAttempts > 4)
    )
      throw new Error('Tool correction attempts must be from 0 to 4');
    if (clean.provider && !inferenceProviders.some((p) => p.id === clean.provider))
      throw new Error('Invalid provider');
    if (
      clean.toolStepLimit !== undefined &&
      (!Number.isInteger(clean.toolStepLimit) ||
        clean.toolStepLimit < 1 ||
        clean.toolStepLimit > 256)
    )
      throw Error('Tool-step limit must be an integer from 1 to 256');
    delete clean.connectedProviders;
    if (value.connectedProviders !== undefined && value !== defaults)
      throw Error('Connections are managed by the app');
    if (clean.language !== undefined && !['en', 'ro'].includes(clean.language))
      throw new Error('Choose English or Romanian');
    if (
      clean.vaultFont !== undefined &&
      !['inter', 'lora', 'garamond', 'mono'].includes(clean.vaultFont)
    )
      throw new Error('Choose a Vault font');
    if (
      clean.apiMaxTokens !== undefined &&
      (!Number.isInteger(clean.apiMaxTokens) ||
        clean.apiMaxTokens < 256 ||
        clean.apiMaxTokens > 65536)
    )
      throw new Error('API output tokens must be from 256 to 65536');
    delete clean.providerProfiles;
    if (value.providerProfiles && Object.keys(value.providerProfiles).length)
      throw new Error('Provider profiles are managed by the app');
    const current = this.settings(),
      profiles = { ...current.providerProfiles };
    if (clean.provider)
      clean.connectedProviders = [...new Set([...current.connectedProviders, clean.provider])];
    if (clean.provider && clean.provider !== current.provider) {
      profiles[current.provider] = {
        endpoint: current.endpoint,
        model: current.model,
        visionEnabled: current.visionEnabled,
      };
      const next = profiles[clean.provider] ?? {
        endpoint: providerInfo(clean.provider).endpoint,
        model: '',
        visionEnabled: true,
      };
      clean.endpoint = value.endpoint ?? next.endpoint;
      clean.model = value.model ?? next.model;
      clean.visionEnabled = value.visionEnabled ?? next.visionEnabled;
      clean.providerProfiles = profiles;
    }
    validateInferenceAddress({
      provider: clean.provider ?? current.provider,
      endpoint: clean.endpoint ?? current.endpoint,
    });
    if (clean.searchProvider !== undefined && !searchProviderIds.includes(clean.searchProvider))
      throw new Error('Choose a supported search provider');
    for (const [key, maximum] of [
      ['searchMaxResults', 20],
      ['searchTimeoutSeconds', 120],
    ])
      if (
        clean[key] !== undefined &&
        (!Number.isInteger(clean[key]) || clean[key] < 1 || clean[key] > maximum)
      )
        throw new Error(`${key} must be an integer from 1 to ${maximum}`);
    for (const [key, maximum] of [
      ['matrixPollSeconds', 3600],
      ['matrixMaxMinutes', 480],
      ['matrixMaxSteps', 128],
      ['matrixPreloadMinutes', 10],
    ])
      if (
        clean[key] !== undefined &&
        (!Number.isInteger(clean[key]) || clean[key] < 1 || clean[key] > maximum)
      )
        throw new Error(`${key} must be an integer from 1 to ${maximum}`);
    if (clean.matrixScheduling && !['round-robin', 'priority'].includes(clean.matrixScheduling))
      throw new Error('Invalid Matrix scheduling');
    for (const key of [
      'matrixWorkingColor',
      'matrixDoneColor',
      'matrixFailedColor',
      'matrixAttentionColor',
      'matrixQueuedColor',
    ])
      if (clean[key] !== undefined && !/^#[a-f0-9]{6}$/i.test(clean[key]))
        throw new Error('Choose a six-digit color');
    if (clean.searxngEndpoint) {
      const url = new URL(clean.searxngEndpoint);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('Use an HTTP SearXNG address without embedded credentials');
      clean.searxngEndpoint = url.origin + url.pathname.replace(/\/$/, '');
    }
    this.db.exec('BEGIN');
    try {
      const q = this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)');
      for (const [k, v] of Object.entries(clean)) q.run(k, JSON.stringify(v));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.emit('changed', { settings: true });
    return this.settings();
  }
  decode(r) {
    if (!r) return null;
    return { ...r, data: JSON.parse(r.data), deleted: !!r.deleted };
  }
  get(id, trash = false) {
    if (typeof id !== 'string' || !id) return null;
    const r = this.decode(this.db.prepare('SELECT * FROM entities WHERE id=?').get(id));
    return r && (!r.deleted || trash) ? r : null;
  }
  all(trash = false, compactReports = false) {
    return this.db
      .prepare(
        `SELECT id,kind,parent,project,title,${compactReports ? "CASE WHEN kind='report' THEN json_remove(data,'$.content','$.sections','$.sources','$.webSources','$.coverage') ELSE data END" : 'data'} data,revision,deleted,created,updated FROM entities ${trash ? '' : 'WHERE deleted=0'} ORDER BY created`,
      )
      .all()
      .map((r) => this.decode(r));
  }
  children(id, deep = false, trash = false) {
    const direct = this.db
      .prepare(
        'SELECT * FROM entities WHERE parent=? ' +
          (trash ? '' : 'AND deleted=0') +
          ' ORDER BY created',
      )
      .all(id)
      .map((r) => this.decode(r));
    return deep ? direct.flatMap((e) => [e, ...this.children(e.id, true, trash)]) : direct;
  }
  notebookOf(e) {
    let current = e;
    while (current) {
      if (current.kind === 'notebook') return current;
      current = current.parent ? this.get(current.parent) : null;
    }
    return null;
  }
  access(id, edit = false, seen = new Set(), includeDeleted = false) {
    if (seen.has(id)) return false;
    seen.add(id);
    let e = this.get(id, includeDeleted);
    if (!e) return false;
    if (e.kind.startsWith('matrix-') && !this.settings().matrixAccess) return false;
    if (['calendar', 'calendar-event'].includes(e.kind) && !this.settings().calendarAccess)
      return false;
    if (['report-template', 'report'].includes(e.kind) && !this.settings().reportsAccess)
      return false;
    if (
      e.kind === 'report' &&
      (e.data.sources || []).some((r) => !this.access(r.id, false, new Set(seen)))
    )
      return false;
    if (e.kind === 'machine') return !edit && e.data.access === true;
    const settings = this.settings();
    if (e.kind === 'conversation')
      return (
        !edit &&
        settings.memoryAccess &&
        !e.data.temporary &&
        !e.data.logContext &&
        !e.data.memoryExcluded &&
        (e.data.context ?? []).every((source) => this.access(source, false, new Set(seen))) &&
        this.messages(e.id).every((m) =>
          (m.data.context ?? []).every((source) => this.access(source, false, new Set(seen))),
        )
      );
    const root = e.kind.startsWith('vault-')
      ? 'vault'
      : e.kind === 'memory'
        ? 'memory'
        : ['board', 'list', 'card'].includes(e.kind)
          ? 'kanban'
          : 'notebook';
    if (root === 'memory')
      return (
        settings.memoryAccess &&
        e.data.access !== false &&
        !['needs_review', 'superseded'].includes(e.data.status) &&
        (e.data.sources ?? []).every((source) => this.access(source, false, new Set(seen)))
      );
    if (
      (['notebook', 'chapter', 'note', 'board', 'list', 'card'].includes(e.kind) ||
        e.kind.startsWith('vault-')) &&
      !settings[root + 'Access']
    )
      return false;
    let allowed = null,
      mode = null;
    while (e) {
      if (allowed === null && typeof e.data.access === 'boolean') allowed = e.data.access;
      if (mode === null && e.data.permission) mode = e.data.permission;
      e = e.parent ? this.get(e.parent, includeDeleted) : null;
    }
    return (
      (allowed === true || (root === 'vault' && allowed === null && settings.vaultAccess)) &&
      (!edit || mode !== 'read')
    );
  }
  assigned(id) {
    let e = this.get(id);
    if (!e || !this.access(id, true)) return false;
    if (e.kind === 'matrix-task') {
      while (e && e.kind !== 'matrix-list') {
        if (e.data.enabled === false) return false;
        e = e.parent ? this.get(e.parent) : null;
      }
      return e?.data.integrated === true;
    }
    while (e) {
      if (typeof e.data.assigned === 'boolean') return e.data.assigned;
      e = e.parent ? this.get(e.parent) : null;
    }
    return false;
  }
  reorder(input, { agent = false, vault = false } = {}) {
    const item = this.get(input.id);
    if (!item || !['list', 'card', 'vault-folder', 'vault-file'].includes(item.kind))
      throw new Error('Choose a board list, card or Vault item to reorder');
    if (item.kind.startsWith('vault-') && !vault)
      throw new Error('Use Vault actions to change Markdown files and folders');
    if (input.revision !== item.revision)
      throw new Error('This item changed. Reload it before moving.');
    const parent = input.parent === undefined ? item.parent : input.parent;
    if (vault && parent !== item.parent)
      throw new Error('Reorder within the current folder. Use Move to change folders.');
    if (item.kind === 'list' && (parent !== item.parent || this.get(parent)?.kind !== 'board'))
      throw new Error('Reorder lists within the current board');
    if (item.kind === 'card') {
      const target = this.get(parent),
        source = this.get(item.parent);
      if (target?.kind !== 'list' || target.parent !== source?.parent)
        throw new Error('Choose a list in this board');
    }
    const siblings = this.all()
      .filter(
        (e) =>
          e.parent === parent &&
          e.id !== item.id &&
          (vault ? e.kind.startsWith('vault-') : e.kind === item.kind),
      )
      .sort(
        (a, b) => (a.data.order ?? Date.parse(a.created)) - (b.data.order ?? Date.parse(b.created)),
      );
    const at =
      input.beforeId == null ? siblings.length : siblings.findIndex((e) => e.id === input.beforeId);
    if (at < 0) throw new Error('The destination changed. Try moving again.');
    if (input.beforeId != null && input.beforeRevision !== siblings[at].revision)
      throw new Error('The destination changed. Try moving again.');
    const ordered = [...siblings];
    ordered.splice(at, 0, item);
    if (
      agent &&
      (!this.access(item.id, true) ||
        ordered.some((e) => !this.access(e.id, true)) ||
        (parent && !this.access(parent, true)))
    )
      throw new Error('Edit access is required for all affected items');
    const ranks = new Map(ordered.map((e, i) => [e.id, i * 1024]));
    const changed = ordered.filter((e) => e.parent !== parent || e.data.order !== ranks.get(e.id));
    this.db.exec('BEGIN');
    try {
      for (const e of changed) {
        this.db
          .prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?,?)')
          .run(e.id, e.revision, JSON.stringify(e), e.updated);
        this.db
          .prepare('UPDATE entities SET parent=?,data=?,revision=revision+1,updated=? WHERE id=?')
          .run(parent, JSON.stringify({ ...e.data, order: ranks.get(e.id) }), now(), e.id);
        this.db.prepare('DELETE FROM vectors WHERE id=?').run(e.id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    if (changed.length) this.emit('changed', { entity: this.get(item.id), previous: item });
    return this.get(item.id);
  }
  mutate(input, { agent = false, vault = false } = {}) {
    if (!input || typeof input !== 'object') throw new Error('Invalid change');
    if (input.action === 'reorder') return this.reorder(input, { agent, vault });
    const action = input.action ?? 'save';
    const previous = input.id ? this.get(input.id, true) : null;
    if (agent && (previous?.kind ?? input.kind) === 'agent-profile')
      throw Error('Only the user can manage agent profiles');
    if ((previous?.kind ?? input.kind)?.startsWith('vault-') && !vault)
      throw new Error('Use Vault actions to change Markdown files and folders');
    if (agent && previous?.kind.startsWith('matrix-'))
      throw new Error('Use the scoped Matrix tools to change Matrix items');
    if (previous?.kind === 'matrix-list' && action !== 'save')
      throw new Error('The three Matrix lists are permanent');
    if (action === 'trash' || action === 'restore') {
      if (!previous) throw new Error('Item no longer exists');
      if (input.revision !== undefined && previous.revision !== input.revision)
        throw new Error('This item changed. Reload it before saving so your edits are preserved.');
      const affected = [previous, ...this.children(previous.id, true, true)];
      if (agent && affected.some((e) => !this.access(e.id, true, new Set(), action === 'restore')))
        throw new Error('Edit access is required for all affected items');
      if (action === 'restore' && previous.parent && this.get(previous.parent, true)?.deleted)
        throw new Error('Restore the parent first');
      this.db.exec('SAVEPOINT trash_mutation');
      try {
        for (const e of affected) {
          this.db
            .prepare('UPDATE entities SET deleted=?,updated=?,revision=revision+1 WHERE id=?')
            .run(action === 'trash' ? 1 : 0, now(), e.id);
          this.index(e.id);
        }
        this.db.exec('RELEASE trash_mutation');
      } catch (e) {
        this.db.exec('ROLLBACK TO trash_mutation; RELEASE trash_mutation');
        throw e;
      }
      this.emit('changed', { entity: this.get(previous.id, true), previous });
      return this.get(previous.id, true);
    }
    if (input.id && !previous) throw new Error('Item no longer exists');
    if (previous?.deleted) throw new Error('Restore this item before editing');
    if (input.revision !== undefined && previous?.revision !== input.revision)
      throw new Error('This item changed. Reload it before saving so your edits are preserved.');
    const kind = previous?.kind ?? input.kind;
    if (!kinds.includes(kind)) throw new Error('Unknown item type');
    if (input.matrixId && (kind !== 'matrix-list' || this.get(input.matrixId, true)))
      throw new Error('Invalid Matrix initialization');
    if ((kind.startsWith('matrix-') || kind.startsWith('vault-')) && input.project)
      throw new Error('This workspace is global');
    if (kind === 'matrix-list') {
      if (
        agent ||
        (!previous &&
          (!input.matrixId || this.all(true).filter((e) => e.kind === kind).length >= 3))
      )
        throw new Error('Cognition Matrix has exactly three lists');
      if (previous?.data.slot === 'core' && input.title !== undefined && input.title !== 'Core')
        throw new Error('Core keeps its name');
    }
    const title = (input.title ?? previous?.title ?? 'Untitled').trim().slice(0, 250);
    if (!title) throw new Error('A title is required');
    const parent = input.parent !== undefined ? input.parent : (previous?.parent ?? null);
    if (parentKinds[kind] && !(kind.startsWith('vault-') && !parent)) {
      const p = this.get(parent);
      if (!p || !parentKinds[kind].includes(p.kind)) throw new Error('Choose a valid parent');
    } else if (parent) throw new Error('This item cannot have a parent');
    const data = { ...previous?.data, ...input.data };
    if (kind === 'calendar-event') Object.assign(data, validateEvent(data));
    if (kind === 'report-template') Object.assign(data, validateReportTemplate(data));
    if (agent && kind === 'report') throw Error('Reports are created by the native report runner');
    if (input.data?.content !== undefined && input.data.content !== previous?.data.content)
      data.editedBy = agent ? 'Agent' : (input.data.editedBy ?? 'User');
    if (kind === 'conversation' && !previous && !data.agentProfile)
      data.agentProfile = this.settings().activeAgent || undefined;
    if (kind === 'matrix-list') {
      if (
        !['core', 'secondary', 'tertiary'].includes(data.slot) ||
        (input.matrixId && input.matrixId !== 'matrix-' + data.slot) ||
        (previous && data.slot !== previous.data.slot)
      )
        throw new Error('Invalid Matrix list');
      if (typeof data.integrated !== 'boolean') throw new Error('Invalid Matrix integration');
      validateMatrixProfile(data.modelProfile);
      if (data.slot === 'core' && title !== 'Core') throw new Error('Core keeps its name');
      if (String(data.description ?? '').length > 12000)
        throw new Error('List descriptions can contain up to 12,000 characters');
    }
    if (kind === 'matrix-task') {
      validateMatrixTrigger(this, previous?.id, data.trigger);
      if (data.output && !['auto', 'answer', 'report'].includes(data.output))
        throw new Error('Invalid task result format');
      if (String(data.content ?? '').length > 100000)
        throw new Error('Task descriptions can contain up to 100,000 characters');
      let ancestor = this.get(parent),
        depth = 0;
      while (ancestor?.kind === 'matrix-task') {
        if (ancestor.id === previous?.id || ++depth > 8)
          throw new Error('Matrix subtasks support up to eight levels');
        ancestor = this.get(ancestor.parent);
      }
    }
    if (
      kind === 'matrix-file' &&
      previous &&
      input.data?.storage !== undefined &&
      input.data.storage !== previous.data.storage
    )
      throw new Error('Attachment storage is immutable');
    if (
      kind === 'matrix-task' &&
      data.status &&
      !['queued', 'running', 'done', 'failed', 'needs_input', 'paused'].includes(data.status)
    )
      throw new Error('Invalid Matrix task state');
    if (
      kind.startsWith('matrix-') &&
      agent &&
      ['integrated', 'slot', 'enabled', 'status', 'conversation', 'result', 'attention'].some(
        (key) => input.data?.[key] !== undefined,
      )
    )
      throw new Error('Use the Matrix tools for execution state');
    if (input.data?.schedule && previous?.data.schedule)
      data.schedule = { ...previous.data.schedule, ...input.data.schedule };
    if (JSON.stringify(data).length > 2_000_000) throw new Error('Item is too large');
    for (const key of ['access', 'assigned'])
      if (data[key] !== undefined && data[key] !== null && typeof data[key] !== 'boolean')
        throw new Error('Invalid policy');
    if (data.permission && !['read', 'edit'].includes(data.permission))
      throw new Error('Invalid permission');
    if (agent) {
      if (previous && !this.access(previous.id, true))
        throw new Error('This item is outside your edit access');
      if (parent && !this.access(parent, true))
        throw new Error('The destination is outside your edit access');
      if (!previous && !parent && kind !== 'memory')
        throw new Error('Creating a top-level collection requires user action');
      for (const k of ['access', 'permission', 'assigned'])
        if (input.data?.[k] !== undefined)
          throw new Error('Only the user can change access and assignment');
      if (['project', 'connection', 'conversation'].includes(kind))
        throw new Error('Use the dedicated user controls for this item');
    }
    if (data.schedule) {
      if (data.schedule.timezone)
        new Intl.DateTimeFormat('en', { timeZone: data.schedule.timezone }).format(new Date());
      if (data.schedule.start && !Number.isFinite(Date.parse(data.schedule.start)))
        throw new Error('Invalid starting time');
      if (!['none', 'daily', 'weekly'].includes(data.schedule.repeat ?? 'none'))
        throw new Error('Invalid recurrence');
      if (
        data.schedule.weekdays !== undefined &&
        (!Array.isArray(data.schedule.weekdays) ||
          !data.schedule.weekdays.length ||
          data.schedule.weekdays.length > 7 ||
          data.schedule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
      )
        throw Error('Choose one or more weekdays');
      if (data.schedule.weekdays?.length && data.schedule.repeat !== 'daily')
        throw Error('Weekday selection uses daily recurrence');
      if (kind === 'matrix-task' && data.schedule.weekdays?.length && input.data?.schedule?.start)
        data.schedule.start = nextOccurrence(
          data.schedule,
          new Date(Date.parse(data.schedule.start) - 1),
        );
    }
    const id = previous?.id ?? input.matrixId ?? randomUUID(),
      revision = (previous?.revision ?? 0) + 1,
      time = now();
    const entity = {
      id,
      kind,
      parent,
      project: kind.startsWith('matrix-')
        ? null
        : input.project !== undefined
          ? input.project
          : (previous?.project ?? null),
      title,
      data,
      revision,
      deleted: false,
      created: previous?.created ?? time,
      updated: time,
    };
    this.db.exec('SAVEPOINT entity_mutation');
    try {
      if (previous)
        this.db
          .prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?,?)')
          .run(id, previous.revision, JSON.stringify(previous), previous.updated);
      this.db
        .prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          kind,
          parent,
          entity.project,
          title,
          JSON.stringify(data),
          revision,
          0,
          entity.created,
          time,
        );
      this.index(id);
      this.db
        .prepare(
          'DELETE FROM versions WHERE id=? AND revision NOT IN (SELECT revision FROM versions WHERE id=? ORDER BY revision DESC LIMIT 30)',
        )
        .run(id, id);
      this.db.prepare('DELETE FROM vectors WHERE id=?').run(id);
      this.db.exec('RELEASE entity_mutation');
    } catch (e) {
      this.db.exec('ROLLBACK TO entity_mutation; RELEASE entity_mutation');
      throw e;
    }
    this.emit('changed', { entity, previous });
    return entity;
  }
  deleteTrash(id) {
    const item = this.get(id, true);
    if (!item?.deleted) throw new Error('Choose an item in Trash');
    if (item.kind === 'matrix-list') throw new Error('The three Matrix lists are permanent');
    const affected = [item, ...this.children(id, true, true)];
    if (affected.some((e) => !e.deleted)) throw new Error('All contained items must be in Trash');
    const ids = new Set(affected.map((e) => e.id));
    // Remove generated summaries/facts whose evidence is being deleted, including
    // memories derived indirectly from other generated memories.
    let expanded = true;
    const all = this.all(true);
    while (expanded) {
      expanded = false;
      for (const e of all) {
        if (
          e.kind === 'memory' &&
          e.data.auto &&
          !ids.has(e.id) &&
          (e.data.sources ?? []).some((source) => ids.has(source))
        ) {
          ids.add(e.id);
          expanded = true;
        }
      }
    }
    const assetNames = (text) =>
      [
        ...String(text).matchAll(
          /intelligence-media:\/\/asset\/([\w.-]+\.(?:png|jpe?g|webp|gif))/gi,
        ),
      ].map((m) => m[1]);
    const candidates = new Set();
    for (const deletedId of ids) {
      const records = [
        JSON.stringify(all.find((e) => e.id === deletedId)?.data),
        ...this.db
          .prepare('SELECT data FROM versions WHERE id=?')
          .all(deletedId)
          .map((r) => r.data),
        ...this.db
          .prepare('SELECT content,data FROM messages WHERE conversation=?')
          .all(deletedId)
          .flatMap((r) => [r.content, r.data]),
      ];
      records.flatMap(assetNames).forEach((name) => candidates.add(name));
    }
    this.db.exec('BEGIN');
    try {
      for (const deletedId of ids) {
        const deletedMemory = all.find((e) => e.id === deletedId && e.kind === 'memory');
        if (deletedMemory) {
          // Retain only a hash to prevent a forgotten fact from being extracted again.
          const tombstone = deletedMemory.data.auto
            ? deletedId
            : 'auto-' +
              createHash('sha256')
                .update(
                  JSON.stringify([
                    deletedMemory.project,
                    'fact',
                    String(deletedMemory.data.content ?? '')
                      .toLowerCase()
                      .replace(/\s+/g, ' ')
                      .trim(),
                  ]),
                )
                .digest('hex');
          this.db.prepare('INSERT OR IGNORE INTO memory_tombstones VALUES(?)').run(tombstone);
        }
        this.db.prepare('DELETE FROM message_search WHERE conversation=?').run(deletedId);
        this.db.prepare('DELETE FROM messages WHERE conversation=?').run(deletedId);
        this.db.prepare('DELETE FROM consolidation WHERE conversation=?').run(deletedId);
        this.db
          .prepare('DELETE FROM runs WHERE card=? OR conversation=?')
          .run(deletedId, deletedId);
        for (const table of ['versions', 'vectors', 'search', 'entities'])
          this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(deletedId);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    let retainedAssets = 0;
    for (const file of all.filter((e) => ids.has(e.id) && e.kind === 'matrix-file')) {
      try {
        if (!/^[a-f0-9-]+(?:\.[a-z0-9]{1,11})?$/i.test(file.data.storage))
          throw new Error('Invalid attachment storage');
        const root = fs.realpathSync(this.directory),
          directory = fs.realpathSync(path.join(root, 'matrix-files'));
        const target = path.resolve(directory, file.data.storage);
        if (!directory.startsWith(root + path.sep) || path.dirname(target) !== directory)
          throw new Error('Attachment is outside Matrix storage');
        fs.unlinkSync(target);
      } catch (error) {
        if (error.code !== 'ENOENT') retainedAssets++;
      }
    }
    if (candidates.size) {
      const references = [
        JSON.stringify(this.settings()),
        ...this.db
          .prepare('SELECT data FROM entities')
          .all()
          .map((r) => r.data),
        ...this.db
          .prepare('SELECT data FROM versions')
          .all()
          .map((r) => r.data),
        ...this.db
          .prepare('SELECT content,data FROM messages')
          .all()
          .flatMap((r) => [r.content, r.data]),
      ];
      const retained = new Set(
        [...references, JSON.stringify(this.settings())].flatMap(assetNames),
      );
      for (const name of candidates) {
        if (retained.has(name)) continue;
        try {
          const directory = fs.realpathSync(this.directory);
          const assetDirectory = fs.realpathSync(path.join(directory, 'assets'));
          const target = path.resolve(assetDirectory, name);
          if (
            !assetDirectory.startsWith(directory + path.sep) ||
            path.dirname(target) !== assetDirectory
          )
            throw new Error('Asset must be in Intelligence storage');
          fs.unlinkSync(target);
        } catch (error) {
          if (error.code !== 'ENOENT') retainedAssets++;
        }
      }
    }
    return { deleted: [...ids], retainedAssets };
  }
  listItems({ kind, parent, project, offset = 0, limit = 30, allowed = () => true } = {}) {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid item offset');
    if (kind && !kinds.includes(kind)) throw new Error('Unknown item type');
    if (parent && !this.access(parent)) throw new Error('Parent is outside agent access');
    const items = this.all().filter(
      (e) =>
        this.access(e.id) &&
        allowed(e) &&
        (!kind || e.kind === kind) &&
        (parent === undefined || e.parent === parent) &&
        (!project ||
          e.project === project ||
          e.kind.startsWith('matrix-') ||
          e.kind.startsWith('vault-') ||
          (e.kind === 'memory' && !e.project)),
    );
    const page = items.slice(offset, offset + limit);
    return {
      items: page.map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        parent: e.parent,
        project: e.project,
        revision: e.revision,
        editable: this.access(e.id, true),
      })),
      total: items.length,
      nextOffset: offset + page.length < items.length ? offset + page.length : null,
    };
  }
  index(id) {
    this.db.prepare('DELETE FROM search WHERE id=?').run(id);
    const e = this.get(id);
    if (e)
      this.db
        .prepare('INSERT INTO search VALUES(?,?,?)')
        .run(id, e.title, e.data.content ?? e.data.description ?? '');
  }
  messages(conversation) {
    return this.db
      .prepare('SELECT * FROM messages WHERE conversation=? ORDER BY created,rowid')
      .all(conversation)
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  recentModelMessages(conversation, turnLimit = 12) {
    const limit = Math.max(1, Math.min(32, Math.trunc(turnLimit)));
    const boundary = this.db
      .prepare(
        "SELECT rowid FROM messages WHERE conversation=? AND role='user' ORDER BY created DESC,rowid DESC LIMIT 1 OFFSET ?",
      )
      .get(conversation, limit - 1);
    return this.db
      .prepare('SELECT * FROM messages WHERE conversation=? AND rowid>=? ORDER BY created,rowid')
      .all(conversation, boundary?.rowid ?? 0)
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  modelMessagesAfter(conversation, before) {
    const boundary = this.db
      .prepare('SELECT rowid FROM messages WHERE id=? AND conversation=?')
      .get(before, conversation);
    if (!boundary) return null;
    return this.db
      .prepare('SELECT * FROM messages WHERE conversation=? AND rowid>=? ORDER BY created,rowid')
      .all(conversation, boundary.rowid)
      .map((row) => ({ ...row, data: JSON.parse(row.data) }));
  }
  message(conversation, role, content, data = {}) {
    if (!this.get(conversation) || typeof content !== 'string')
      throw new Error('Invalid conversation');
    const m = { id: randomUUID(), conversation, role, content, data, created: now() };
    this.db
      .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
      .run(m.id, conversation, role, content, JSON.stringify(data), m.created);
    if (['user', 'assistant'].includes(role) && !data.tool && !data.error)
      this.db.prepare('INSERT INTO message_search VALUES(?,?,?)').run(m.id, conversation, content);
    return m;
  }
  messageData(id, data) {
    const row = this.db.prepare('SELECT data FROM messages WHERE id=?').get(id);
    if (!row) throw new Error('Message not found');
    this.db
      .prepare('UPDATE messages SET data=? WHERE id=?')
      .run(JSON.stringify({ ...JSON.parse(row.data), ...data }), id);
  }
  searchConversations(query, { project = null, limit = 8 } = {}) {
    if (!this.settings().memoryAccess) throw new Error('Memory access is disabled');
    const words = String(query).match(/[\p{L}\p{N}_-]+/gu) ?? [];
    if (!words.length) return [];
    const match = words
      .slice(0, 20)
      .map((w) => '"' + w + '"*')
      .join(' OR ');
    return this.db
      .prepare(
        'SELECT id,conversation,content FROM message_search WHERE message_search MATCH ? ORDER BY bm25(message_search)',
      )
      .all(match)
      .filter((row) => {
        const c = this.get(row.conversation);
        return (
          c && c.kind === 'conversation' && (!project || c.project === project) && this.access(c.id)
        );
      })
      .slice(0, Math.min(20, Math.max(1, limit)))
      .map((row) => ({
        conversation: row.conversation,
        title: this.get(row.conversation).title,
        message: row.id,
        excerpt: row.content.slice(0, 1200),
      }));
  }
  readConversation(id, { project = null, offset = 0 } = {}) {
    const c = this.get(id);
    if (!c || c.kind !== 'conversation' || !this.access(id) || (project && c.project !== project))
      throw new Error('Conversation is outside memory access or the current project');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid conversation offset');
    const messages = this.messages(id).filter((m) => !m.data.tool && !m.data.error);
    // Fixed-size text chunks preserve complete messages while keeping tool results bounded.
    const chunks = messages.flatMap((m) =>
      Array.from({ length: Math.max(1, Math.ceil(m.content.length / 2000)) }, (_, index) => ({
        id: m.id,
        role: m.role,
        created: m.created,
        part: index + 1,
        content: m.content.slice(index * 2000, (index + 1) * 2000),
      })),
    );
    return {
      conversation: id,
      title: c.title,
      messages: chunks.slice(offset, offset + 4),
      nextOffset: offset + 4 < chunks.length ? offset + 4 : null,
    };
  }
  consolidationCursor(id) {
    return this.db.prepare('SELECT cursor FROM consolidation WHERE conversation=?').get(id)?.cursor;
  }
  inspectMemory(id) {
    const memory = this.get(id);
    if (memory?.kind !== 'memory') throw new Error('Memory no longer exists');
    const ids = new Set(memory.data.messageIds ?? []);
    const messages = memory.data.conversation
      ? this.messages(memory.data.conversation).filter(
          (m) => ids.has(m.id) && !m.data.tool && !m.data.error,
        )
      : [];
    return {
      available: this.access(id),
      reason: !this.settings().memoryAccess
        ? 'Memory access is disabled'
        : memory.data.status === 'needs_review'
          ? 'Review this conflicting fact before agent use'
          : memory.data.status === 'superseded'
            ? 'This memory has been replaced'
            : !this.access(id)
              ? 'A source or this memory is outside agent access'
              : 'Available for recall when relevant; agent profile scopes still apply',
      sources: (memory.data.sources ?? []).slice(0, 40).map((source) => {
        const entity = this.get(source, true);
        return {
          id: source,
          title: entity?.title ?? '',
          kind: entity?.kind ?? '',
          deleted: !entity || entity.deleted,
          available: this.access(source),
        };
      }),
      messageCount: messages.length,
      messages: messages
        .slice(0, 12)
        .map((m) => ({
          id: m.id,
          role: m.role,
          created: m.created,
          content: redactLog(m.content).slice(0, 800),
          truncated: m.content.length > 800,
        })),
    };
  }
  commitConsolidation(conversation, cursor, summary, facts, messageIds, sourceIds) {
    const c = this.get(conversation);
    if (!c || !this.access(conversation) || !this.settings().autoConsolidation) return;
    const sources = [...new Set([conversation, ...sourceIds])],
      time = now();
    const records = [];
    if (summary) records.push({ type: 'summary', key: cursor, content: summary, messageIds });
    for (const fact of facts) records.push({ type: 'fact', ...fact });
    this.db.exec('BEGIN');
    try {
      for (const record of records) {
        const normalized = record.content.toLowerCase().replace(/\s+/g, ' ').trim();
        const id =
          'auto-' +
          createHash('sha256')
            .update(
              JSON.stringify([
                c.project,
                record.type,
                record.type === 'summary' ? [conversation, cursor] : normalized,
              ]),
            )
            .digest('hex');
        // A forgotten or edited memory is never recreated by consolidation.
        const existing = this.get(id, true);
        if (existing || this.db.prepare('SELECT 1 FROM memory_tombstones WHERE id=?').get(id))
          continue;
        if (
          record.type === 'fact' &&
          this.all(true).some(
            (e) =>
              e.kind === 'memory' &&
              e.project === c.project &&
              e.data.type !== 'summary' &&
              String(e.data.content ?? '')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim() === normalized,
          )
        )
          continue; // Preserve manually saved/forgotten facts instead of creating duplicates.
        const conflicts =
          record.type === 'fact'
            ? this.all()
                .filter(
                  (e) =>
                    e.kind === 'memory' &&
                    e.project === c.project &&
                    e.data.auto &&
                    e.data.type === 'fact' &&
                    e.data.key === record.key &&
                    !['superseded'].includes(e.data.status),
                )
                .map((e) => e.id)
            : [];
        const data = {
          auto: true,
          type: record.type,
          key: record.key,
          content: record.content,
          sources,
          conversation,
          messageIds: record.messageIds,
          evidence: record.evidence,
          status: conflicts.length ? 'needs_review' : 'active',
          conflicts,
          model: 'MiniCPM5-1B-Q4_K_M',
        };
        this.db
          .prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(
            id,
            'memory',
            null,
            c.project,
            record.type === 'summary' ? 'Conversation · ' + c.title : record.content.slice(0, 70),
            JSON.stringify(data),
            1,
            0,
            time,
            time,
          );
        this.index(id);
      }
      this.db
        .prepare('INSERT OR REPLACE INTO consolidation VALUES(?,?,?)')
        .run(conversation, cursor, time);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  resolveMemory(id) {
    const selected = this.get(id);
    if (!selected || selected.kind !== 'memory' || selected.data.status !== 'needs_review')
      throw new Error('Choose a conflicting fact to review');
    this.db.exec('BEGIN');
    try {
      for (const e of this.all().filter(
        (e) =>
          e.kind === 'memory' &&
          e.project === selected.project &&
          e.data.type === 'fact' &&
          e.data.key === selected.data.key,
      )) {
        this.db
          .prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?,?)')
          .run(e.id, e.revision, JSON.stringify(e), e.updated);
        const data = { ...e.data, status: e.id === id ? 'active' : 'superseded', reviewed: true };
        this.db
          .prepare('UPDATE entities SET data=?,revision=revision+1,updated=? WHERE id=?')
          .run(JSON.stringify(data), now(), e.id);
        this.db.prepare('DELETE FROM vectors WHERE id=?').run(e.id);
        this.index(e.id);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  history(id) {
    return this.db
      .prepare('SELECT * FROM versions WHERE id=? ORDER BY revision DESC LIMIT 30')
      .all(id)
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }
  search(query, { agent = false, limit = 20, kind, project } = {}) {
    const words = String(query).match(/[\p{L}\p{N}_-]+/gu) ?? [];
    if (!words.length) return [];
    const match = words
      .slice(0, 20)
      .map((w) => '"' + w.replaceAll('"', '') + '"*')
      .join(' OR ');
    const ranked = this.db
      .prepare('SELECT id,bm25(search) AS rank FROM search WHERE search MATCH ? ORDER BY rank')
      .all(match);
    return ranked
      .map((r) => ({ ...this.get(r.id), score: -r.rank }))
      .filter(
        (e) =>
          e.id &&
          (!kind || e.kind === kind) &&
          (!project || e.project === project || (e.kind === 'memory' && !e.project)) &&
          (!agent || this.access(e.id)),
      )
      .slice(0, limit);
  }
  vector(id, model, values, expectedRevision) {
    const e = this.get(id);
    if (e && (expectedRevision === undefined || e.revision === expectedRevision))
      this.db
        .prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?)')
        .run(id, e.revision, model, JSON.stringify(values));
  }
  vectors(model) {
    return this.db
      .prepare('SELECT * FROM vectors WHERE model=?')
      .all(model)
      .map((r) => ({ ...r, vector: JSON.parse(r.vector) }))
      .filter((r) => this.get(r.id)?.revision === r.revision);
  }
  vectorIds(model) {
    return this.db
      .prepare(
        'SELECT v.id FROM vectors v JOIN entities e ON e.id=v.id AND e.revision=v.revision WHERE v.model=? AND e.deleted=0',
      )
      .all(model)
      .map((row) => row.id);
  }
  snapshot() {
    return {
      settings: this.settings(),
      entities: this.all().map((entity) =>
        entity.kind === 'card'
          ? {
              ...entity,
              agentAccess: this.access(entity.id),
              agentEditable: this.access(entity.id, true),
              agentAssigned: this.assigned(entity.id),
            }
          : entity,
      ),
      runs: this.db.prepare('SELECT * FROM runs ORDER BY start DESC LIMIT 100').all(),
    };
  }
  seed() {
    this.setSettings(defaults);
    this.db.prepare('INSERT INTO settings VALUES(?,?)').run('initialized', 'true');
    const welcome = this.mutate({
      kind: 'notebook',
      title: 'The Linux notebook',
      data: {
        icon: '✳',
        cover: 'day',
        description: 'A home for discoveries, little victories, and things worth remembering.',
        access: true,
        permission: 'edit',
      },
    });
    const chapter = this.mutate({
      kind: 'chapter',
      parent: welcome.id,
      title: 'Getting acquainted',
      data: { icon: '⌘', description: 'Start with a little curiosity.' },
    });
    this.mutate({
      kind: 'note',
      parent: chapter.id,
      title: 'A place to begin',
      data: {
        content:
          '# A place to begin\n\nYour computer should feel like something you understand. This notebook is a place to collect what you learn along the way.\n\n## Make it yours\n\n- Write a note about your Linux setup.\n- Add images, links, and a few questions.\n- Ask Intelligence to explain something unfamiliar.\n\n> Small discoveries add up.\n\n## A living notebook\n\nType Markdown and watch it become formatted text. Notes can live directly in a notebook, or in a chapter when you want a little more structure.\n',
      },
    });
    this.mutate({
      kind: 'note',
      parent: welcome.id,
      title: 'Questions for another day',
      data: {
        content:
          '# Questions for another day\n\n- What is the difference between a service and an application?\n- Where does Linux keep configuration files?\n- How can I tell what is using my memory?\n',
      },
    });
    this.mutate({
      kind: 'notebook',
      title: 'Ideas in motion',
      data: {
        icon: '↗',
        cover: 'night',
        description: 'The beginnings of something good.',
        access: false,
      },
    });
    this.mutate({
      kind: 'notebook',
      title: 'Everyday rituals',
      data: {
        icon: '☼',
        cover: 'day',
        description: 'Useful routines for a calmer desktop.',
        access: false,
      },
    });
    const board = this.mutate({
      kind: 'board',
      title: 'A little progress',
      data: {
        description: 'Turn a good intention into a next step.',
        access: true,
        permission: 'edit',
        assigned: false,
      },
    });
    for (const title of ['To explore', 'In progress', 'Done'])
      this.mutate({ kind: 'list', parent: board.id, title, data: {} });
    this.mutate({
      kind: 'skill',
      title: 'Understand a Linux problem',
      data: {
        description: 'Inspect, explain, and verify.',
        access: true,
        content:
          '# Understand a Linux problem\n\nIdentify the distribution and relevant components. Read diagnostic information before changing configuration. Explain proposed changes in ordinary language. Request approval for host commands. Verify the outcome and record useful lessons.',
      },
    });
  }
  close() {
    this.db.close();
  }
}

export function validateOptionalModules(modules) {
  if (modules !== undefined) {
    if (!modules || Array.isArray(modules) || typeof modules !== 'object')
      throw Error('Invalid optional module settings');
    for (const [id, config] of Object.entries(modules)) {
      if (
        !['tts', 'stt', 'zim'].includes(id) ||
        !config ||
        Array.isArray(config) ||
        typeof config !== 'object'
      )
        throw Error('Invalid optional module settings');
      for (const [key, entry] of Object.entries(config)) {
        if (
          ![
            'enabled',
            'adapter',
            'endpoint',
            'model',
            'voice',
            'directory',
            'engine',
            'localVoice',
            'recognitionModel',
          ].includes(key)
        )
          throw Error('Invalid module configuration');
        if (key === 'enabled') {
          if (typeof entry !== 'boolean') throw Error('Invalid module enable preference');
        } else if (typeof entry !== 'string' || entry.length > 4096)
          throw Error('Invalid module configuration');
        if (key === 'adapter' && !['local', 'compatible'].includes(entry))
          throw Error('Choose local or compatible audio API');
        if (key === 'engine' && (id !== 'tts' || !['piper', 'kokoro'].includes(entry)))
          throw Error('Choose Piper or Kokoro');
        if (
          key === 'localVoice' &&
          (id !== 'tts' || !['af_heart', 'af_bella', 'am_michael'].includes(entry))
        )
          throw Error('Choose a supported English voice');
        if (key === 'recognitionModel' && (id !== 'stt' || !['fast', 'larger'].includes(entry)))
          throw Error('Choose a supported English dictation model');
        if (key === 'endpoint' && entry) {
          const url = new URL(entry);
          if (
            url.username ||
            url.password ||
            (url.protocol !== 'https:' &&
              !(
                url.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
              ))
          )
            throw Error('Audio APIs require HTTPS or HTTP on loopback');
        }
      }
    }
  }
}
