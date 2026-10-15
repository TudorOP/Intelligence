import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  Tray,
  Menu,
  nativeImage,
  shell,
  screen,
  safeStorage,
  clipboard,
  Notification,
  powerMonitor,
} from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { Memory } from './memory.mjs';
import { Consolidator } from './consolidation.mjs';
import { Agent } from './agent.mjs';
import { Connections } from './connections.mjs';
import { ensureBuiltinSkills } from './skills.mjs';
import { ContextManager } from './context.mjs';
import { listModels, completion } from './provider.mjs';
import { matrixInference, validateMatrixProfile } from './matrix-config.mjs';
import { Vault } from './vault.mjs';
import { validateChatImages } from './vision.mjs';
import { localized } from './locale.mjs';
import {
  InferenceCredentials,
  inferenceProviders,
  disconnectProvider,
  requireConnectedProvider,
} from './inference-providers.mjs';
import { nextOccurrence } from './schedule.mjs';
import { machineIdentity, inspectMachine, machineProfileData } from './system.mjs';
import { inspectContainers, readLogs } from './workloads.mjs';
import { CognitionMatrix } from './matrix.mjs';
import { WebSearch } from './web-search.mjs';
import { SearchCredentials } from './search-credentials.mjs';
import { Workspace } from './workspace.mjs';
import { ensureProfiles, profileSettings } from './profiles.mjs';
import { requireAssignedAgent } from './assignments.mjs';
import { resourceKinds, resourceGate, resourceGroup } from './resource-catalog.mjs';
import { exportBackup, inspectBackup, restoreBackup } from './backup.mjs';
import { ExternalEvents, wakeCapability, updateWake } from './automation.mjs';
import { Planning } from './planning.mjs';
import { projectPath } from './projects.mjs';
import { deleteTrashBatch } from './trash-bulk.mjs';
import { OptionalModules } from './optional-modules.mjs';
import { restoreWindow } from './window-state.mjs';
import { importBackgroundImage } from './appearance-settings.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setupFixture =
  process.env.INTELLIGENCE_TEST === '1' && process.env.INTELLIGENCE_TEST_ONBOARDING === '1';
const iconPath = path.join(root, 'build', 'icon.png');
let setupInvitationOffered = false;
const connectionTests = new Map();
const modelRequests = new Map(),
  modelCatalogs = new Map();
const iconFor = (style) =>
  ['prism', 'aurora'].includes(style) ? path.join(root, 'build', `icon-${style}.png`) : iconPath;
function iconImage(style, size) {
  const image = nativeImage.createFromPath(iconFor(style));
  if (image.isEmpty()) throw new Error('Could not load app icon');
  return image.resize({ width: size, height: size });
}
function updateIcons(settings) {
  window?.setIcon(iconImage(settings.appIcon, 256));
  tray?.setImage(iconImage(settings.trayIcon, 24));
}
app.on('before-quit', () => optionalModules?.dispose());
app.setName('Intelligence');
app.setPath(
  'userData',
  process.env.INTELLIGENCE_DATA_DIR ?? path.join(app.getPath('appData'), 'Intelligence'),
);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'intelligence-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let window,
  store,
  memory,
  consolidator,
  connections,
  agent,
  matrix,
  webSearch,
  searchCredentials,
  inferenceCredentials,
  optionalModules,
  vault,
  workspace,
  planning,
  externalEvents,
  tray,
  quitting = false,
  scheduling = false;
const emit = (event) => {
  if (event.type === 'changed') planning?.reconcile();
  if (
    event.type === 'report-ready' &&
    event.delivery !== 'quiet' &&
    store.settings().activityNotifications &&
    Notification.isSupported() &&
    !window?.isFocused()
  ) {
    const notice = new Notification({
      title: localized('Report ready', store.settings().language),
      body: event.summary,
    });
    notice.on('click', () => {
      window?.show();
      window?.webContents.send('intelligence:event', { type: 'navigate', id: event.id });
    });
    notice.show();
  }
  if (event.type === 'changed' && agent)
    for (const [conversation, controller] of agent.active) {
      if (!controller.taskId) continue;
      const task = store.get(controller.taskId);
      if (
        !task ||
        !store.withAgentScope(
          agent.accessRequests.scope(
            agent.runProfiles.get(conversation) || profileSettings(store),
            'task-start',
          ),
          () => store.access(task.id, true) && store.assigned(task.id),
        ) ||
        controller.taskBrief !==
          JSON.stringify([
            task.title,
            task.parent,
            task.data.content,
            task.data.criteria,
            task.data.links,
          ])
      )
        controller.abort();
    }
  if (workspace && ['notice', 'error', 'approval', 'done'].includes(event.type)) {
    workspace.record(
      event.type === 'error' ? 'notice' : event.type,
      event.entity ?? event.conversation,
      event.summary ?? event.error ?? 'Agent response finished',
      event.data ?? {},
    );
    if (
      store.settings().activityNotifications &&
      !store.get(event.conversation)?.data.report &&
      Notification.isSupported() &&
      !window?.isFocused()
    ) {
      const notice = new Notification({
        title: 'Intelligence',
        body:
          event.summary ??
          event.error ??
          localized('Agent response finished', store.settings().language),
      });
      notice.on('click', () => {
        window?.show();
        window?.webContents.send('intelligence:event', {
          type: 'navigate',
          id: event.conversation,
        });
      });
      notice.show();
    }
  }
  if (event.type === 'changed' && store?.settings().wakeForTasks) {
    try {
      updateWake(store);
    } catch (e) {
      console.error('Wake alarm:', e.message);
    }
  }
  if (event.type === 'changed') matrix?.refresh();
  if (window && !window.isDestroyed()) window.webContents.send('intelligence:event', event);
};
const change = () => emit({ type: 'changed' });
function rebuildTray() {
  if (!tray) return;
  const s = store.settings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: localized('Open Intelligence', s.language), click: () => window.show() },
      {
        label: localized(
          s.backgroundPaused ? 'Resume background AI' : 'Pause background AI',
          s.language,
        ),
        click: () => setBackgroundPaused(!store.settings().backgroundPaused),
      },
      { type: 'separator' },
      {
        label: localized('Quit', s.language),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
function setBackgroundPaused(paused) {
  const s = store.setSettings({ backgroundPaused: paused });
  if (paused) {
    if (planning?.running && !planning.running.manual) planning.stop();
    consolidator.pause();
    consolidator.runner.close?.();
    void memory.release().catch(() => {});
    for (const id of agent.active.keys()) {
      const convo = store.get(id),
        task = store.get(convo?.data.task);
      if (task?.kind === 'card') {
        store.mutate({ id: task.id, data: { status: 'paused' } });
        agent.stop(id);
      }
    }
  }
  matrix.refresh();
  void externalEvents?.refresh().catch((e) => emit({ type: 'notice', error: e.message }));
  try {
    updateWake(store);
  } catch (e) {
    console.error('Wake alarm:', e.message);
  }
  rebuildTray();
  change();
  return s;
}
if (process.env.INTELLIGENCE_TEST !== '1') {
  if (!app.requestSingleInstanceLock()) app.exit(0);
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
}
function handle(name, fn) {
  ipcMain.handle('intelligence:' + name, async (event, ...args) => {
    if (
      !window ||
      event.sender.id !== window.webContents.id ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Untrusted caller');
    if (
      workspace?.maintenance &&
      ['mutate', 'settings', 'vault', 'chat', 'run-task', 'project', 'matrix-action'].includes(name)
    )
      throw Error('A backup operation is in progress. Try again when it finishes.');
    return fn(...args);
  });
}
async function importImage(purpose) {
  const result = await dialog.showOpenDialog(window, {
    title: localized('Choose an image', store.settings().language),
    filters: [
      {
        name: 'Images',
        extensions:
          purpose === 'background'
            ? ['png', 'jpg', 'jpeg', 'webp']
            : ['png', 'jpg', 'jpeg', 'webp', 'gif'],
      },
    ],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  const source = result.filePaths[0],
    stat = await fs.stat(source);
  if (purpose === 'background') return importBackgroundImage(source, store.directory);
  if (stat.size > 20 * 1024 * 1024) throw new Error('Please choose an image smaller than 20 MB');
  if (purpose === 'vision' && stat.size > 10 * 1024 * 1024)
    throw new Error('Vision images must be smaller than 10 MB');
  const ext = path.extname(source).toLowerCase();
  const name = randomUUID() + ext;
  await fs.mkdir(path.join(store.directory, 'assets'), { recursive: true });
  await fs.copyFile(source, path.join(store.directory, 'assets', name));
  return 'intelligence-media://asset/' + name;
}
async function exportNotebook(id) {
  const e = store.get(id);
  if (!e || e.kind !== 'notebook') throw new Error('Choose a notebook');
  const result = await dialog.showOpenDialog(window, {
    title: localized('Export notebook into a folder', store.settings().language),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return null;
  const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'Untitled';
  const target = path.join(result.filePaths[0], safe(e.title) + '-' + id.slice(0, 8));
  await fs.mkdir(target, { recursive: true });
  const children = store.children(id, true);
  const portableMetadata = JSON.stringify(
    { format: 'Intelligence notebook', version: 1, notebook: e, items: children },
    null,
    2,
  );
  await fs.writeFile(
    path.join(target, 'notebook.json'),
    portableMetadata.replaceAll('intelligence-media://asset/', 'assets/'),
  );
  for (const match of portableMetadata.matchAll(
    /intelligence-media:\/\/asset\/([a-f0-9-]+\.(?:png|jpe?g|webp|gif))/gi,
  )) {
    await fs.mkdir(path.join(target, 'assets'), { recursive: true });
    await fs.copyFile(
      path.join(store.directory, 'assets', match[1]),
      path.join(target, 'assets', match[1]),
    );
  }
  for (const note of children.filter((e) => e.kind === 'note')) {
    const parent = store.get(note.parent);
    const directory =
      parent.kind === 'chapter'
        ? path.join(target, safe(parent.title) + '-' + parent.id.slice(0, 8))
        : target;
    await fs.mkdir(directory, { recursive: true });
    const content = (note.data.content ?? '').replaceAll('intelligence-media://asset/', 'assets/');
    await fs.writeFile(
      path.join(directory, safe(note.title) + '-' + note.id.slice(0, 8) + '.md'),
      content,
    );
    const matches = [
      ...(note.data.content ?? '').matchAll(/intelligence-media:\/\/asset\/([\w.-]+)/g),
    ];
    for (const m of matches) {
      await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
      await fs
        .copyFile(path.join(store.directory, 'assets', m[1]), path.join(directory, 'assets', m[1]))
        .catch(() => {});
    }
  }
  return target;
}
function setup() {
  handle('workspace', async (input) => {
    if (
      workspace.maintenance &&
      !['activity', 'history', 'receipt', 'read-activity'].includes(input.action)
    )
      throw Error('A backup operation is in progress');
    if (input.action.startsWith('chat-attachment-')) {
      const conversation = agent.chatFiles.conversation(input.conversation);
      if (input.action === 'chat-attachment-list') return agent.chatFiles.list(conversation.id);
      if (agent.active.has(conversation.id))
        throw Error('Wait for the response to finish before changing attachments');
      if (input.action === 'chat-attachment-remove') {
        await agent.chatFiles.remove(conversation.id, input.id);
        change();
        return agent.chatFiles.list(conversation.id);
      }
      if (input.action === 'chat-attachment-keep') {
        const item = agent.chatFiles.list(conversation.id).find((f) => f.id === input.id);
        if (!item) throw Error('Attachment not found');
        const destination = 'Sources/' + item.name.replaceAll('\\', '/');
        try {
          await agent.chatFiles.keep(conversation.id, item.id, input.project, destination, {
            user: true,
          });
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          await agent.chatFiles.keep(
            conversation.id,
            item.id,
            input.project,
            'Sources/' + item.id.slice(0, 8) + '-' + path.basename(item.name),
            { user: true },
          );
        }
        change();
        return agent.chatFiles.list(conversation.id);
      }
      if (input.action !== 'chat-attachment-add') throw Error('Unsupported attachment action');
      if (input.retention === 'project' && store.get(input.project)?.kind !== 'project')
        throw Error('Choose a project for retained files');
      const selection = await dialog.showOpenDialog(window, {
        title: localized(
          input.folder ? 'Attach folder snapshot' : 'Attach files and images',
          store.settings().language,
        ),
        properties: input.folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
      });
      if (selection.canceled) return { files: agent.chatFiles.list(conversation.id), skipped: [] };
      const result = await agent.chatFiles.import(conversation.id, selection.filePaths, {
        folder: input.folder === true,
      });
      const warnings = [];
      if (input.retention === 'project')
        for (const id of result.added) {
          const item = result.files.find((f) => f.id === id);
          try {
            await agent.chatFiles.keep(
              conversation.id,
              id,
              input.project,
              'Sources/' + item.name.replaceAll('\\', '/'),
              { user: true },
            );
          } catch (e) {
            if (e.code === 'EEXIST') {
              try {
                await agent.chatFiles.keep(
                  conversation.id,
                  id,
                  input.project,
                  'Sources/' + id.slice(0, 8) + '-' + path.basename(item.name),
                  { user: true },
                );
              } catch (error) {
                warnings.push(item.name + ': ' + error.message);
              }
            } else warnings.push(item.name + ': ' + e.message);
          }
        }
      change();
      return { ...result, files: agent.chatFiles.list(conversation.id), warnings };
    }
    if (input.action === 'matrix-file-queue') {
      if (store.get(input.id)?.kind !== 'matrix-task') throw Error('Matrix task not found');
      return matrix.triggers.inbox.history(input.id);
    }
    if (input.action === 'access-overview') {
      if (store.get(input.profile)?.kind !== 'agent-profile')
        throw Error('Agent profile not found');
      const settings = profileSettings(store, { data: { agentProfile: input.profile } }),
        scope = agent.accessRequests.scope(settings, 'access-overview');
      return store.withAgentScope(scope, () =>
        store
          .all(false, true)
          .filter(
            (e) =>
              !e.parent &&
              resourceKinds.has(e.kind) &&
              e.title.toLocaleLowerCase().includes(String(input.query || '').toLocaleLowerCase()),
          )
          .slice(0, 100)
          .map((e) => {
            const gate = resourceGate(e),
              blocked = gate && !store.settings()[gate],
              toolBlocked =
                settings.profileScope?.toolGroups &&
                !settings.profileScope.toolGroups.includes(resourceGroup(e));
            const read = !toolBlocked && store.access(e.id),
              edit = read && store.access(e.id, true);
            return {
              id: e.id,
              title: e.title,
              reason: blocked
                ? 'Blocked globally'
                : toolBlocked
                  ? 'Blocked by profile tools'
                  : edit
                    ? 'Read & edit'
                    : read
                      ? 'Read only'
                      : 'Not granted to this agent',
            };
          }),
      );
    }
    if (input.action.startsWith('module-')) {
      const action = input.action.slice(7),
        id = input.id;
      if (action === 'status') return optionalModules.state();
      if (['install', 'update', 'verify'].includes(action))
        return optionalModules.install(optionalModules.engineId(id));
      if (action === 'configure') return optionalModules.config(id, input.configuration);
      if (action === 'uninstall')
        return optionalModules.remove(input.engineId || optionalModules.engineId(id));
      if (action === 'cancel' || action === 'stop') {
        input.session ? optionalModules.stopSession(input.session) : optionalModules.stop(id);
        return optionalModules.state();
      }
      if (action === 'download-model')
        return optionalModules.modelDownload(optionalModules.engineId(id));
      if (action === 'key') {
        const credentials = optionalModules.credentials(id);
        if (!credentials) throw Error('Set the audio API address before saving its key');
        credentials.save(input.key);
        return optionalModules.state();
      }
      if (action === 'forget-key') {
        optionalModules.credentials(id).forget();
        return optionalModules.state();
      }
      if (action === 'source') {
        await shell.openExternal(optionalModules.definition(optionalModules.engineId(id)).source);
        return true;
      }
      if (action === 'speak') return optionalModules.startSpeech('tts', { text: input.text });
      if (action === 'listen') return optionalModules.startSpeech('stt');
      if (action === 'listen-push') return optionalModules.pushAudio(input.session, input.audio);
      if (action === 'listen-finish') return optionalModules.finishSpeech(input.session);
      if (action === 'zim') return optionalModules.zim(input.request);
      if (action === 'build-links') {
        if (optionalModules.jobs.size)
          throw Error('Wait for the current module operation or cancel it');
        const controller = new AbortController();
        optionalModules.jobs.set('zim', controller);
        optionalModules.report('zim', { status: 'building-links' });
        void optionalModules
          .zim({ action: 'build-links', archive: input.archive }, controller.signal)
          .then((result) => optionalModules.report('zim', { status: 'installed', ...result }))
          .catch((e) =>
            optionalModules.report('zim', {
              status: controller.signal.aborted ? 'cancelled' : 'error',
              error: e.message,
            }),
          )
          .finally(() => optionalModules.jobs.delete('zim'));
        return optionalModules.state();
      }
      throw Error('Unknown module action');
    }
    if (input.action === 'support-kofi') {
      await shell.openExternal('https://ko-fi.com/B0B5KQRRD');
      return true;
    }
    if (input.action === 'open-source-link') {
      const url = new URL(input.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw Error('Only HTTP or HTTPS source links can be opened');
      await shell.openExternal(url.href);
      return true;
    }
    if (input.action === 'project-open') {
      const target = await projectPath(store, input.project, input.path, { user: true });
      const error = await shell.openPath(target.file);
      if (error) throw Error(error);
      return true;
    }
    if (input.action === 'automation-info')
      return {
        wake: wakeCapability(),
        eventUrl: 'http://127.0.0.1:' + store.settings().externalEventsPort + '/events/CHANNEL',
        token: input.reveal ? externalEvents.token() : null,
      };
    if (input.action.startsWith('backup-')) {
      if (
        optionalModules.jobs.size ||
        optionalModules.sessions.size ||
        optionalModules.children.size
      )
        throw Error('Stop speech and module operations before backing up or restoring');
      if (agent.active.size)
        throw Error('Wait for active agents to finish before backing up or restoring');
      let directory = input.directory;
      if (!directory) {
        const chosen = await dialog.showOpenDialog(window, {
          title: localized(
            input.action === 'backup-create'
              ? 'Choose a backup destination'
              : 'Choose a backup folder',
            store.settings().language,
          ),
          properties: [
            'openDirectory',
            ...(input.action === 'backup-create' ? ['createDirectory'] : []),
          ],
        });
        if (chosen.canceled) return null;
        directory = chosen.filePaths[0];
      }
      if (input.action === 'backup-preview') return inspectBackup(directory);
      if (!['backup-create', 'backup-restore'].includes(input.action))
        throw Error('Unknown backup action');
      const paused = store.settings().backgroundPaused;
      setBackgroundPaused(true);
      workspace.maintenance = true;
      try {
        await memory.release();
        const result =
          input.action === 'backup-create'
            ? await exportBackup(store, directory, {
                includeModelCaches: input.includeModelCaches === true,
                includeModules: input.includeModules === true,
              })
            : await restoreBackup(store, directory);
        if (input.action === 'backup-restore') {
          optionalModules.dispose();
          optionalModules.verified.clear();
          speechCredentials.clear();
          result.moduleRestore = await optionalModules.reconnectBackup(
            result.modulesToReconnect,
            result.preview,
          );
          await Promise.allSettled(
            [...new Set([...connections.clients.keys(), ...connections.pending.keys()])].map((id) =>
              connections.disconnect(id),
            ),
          );
          ensureProfiles(store);
          await memory.release();
          await window.webContents.session.clearCache();
        }
        change();
        return result;
      } finally {
        workspace.maintenance = false;
        if (input.action === 'backup-create') setBackgroundPaused(paused);
        rebuildTray();
      }
    }
    if (input.action === 'pause') return setBackgroundPaused(input.paused === true);
    if (input.action === 'branch' && agent.active.has(input.id))
      throw Error('Wait for this response to finish before branching');
    const result = await workspace.action(input);
    if (
      ![
        'conversations-list',
        'activity',
        'history',
        'receipt',
        'project-history',
        'calendar-range',
        'calendar-calendars',
        'calendar-read',
        'reports-list',
        'reports-read',
        'reports-preview',
        'task-report',
        'visit',
      ].includes(input.action) &&
      !(input.action === 'project-files' && ['list', 'read'].includes(input.operation))
    )
      change();
    return result;
  });
  handle('bootstrap', async () => {
    const actorScope = agent.accessRequests.scope(profileSettings(store), 'bootstrap');
    const cardAccess = (e) => {
      try {
        const settings = profileSettings(store, {
          data: { agentProfile: requireAssignedAgent(store, e) },
        });
        return store.withAgentScope(agent.accessRequests.scope(settings, 'bootstrap'), () => ({
          ...e,
          agentAccess: store.access(e.id),
          agentEditable: store.access(e.id, true),
          agentAssigned: store.assigned(e.id),
        }));
      } catch {
        return { ...e, agentAccess: false, agentEditable: false, agentAssigned: false };
      }
    };
    return {
      ...store.snapshot(false),
      entities: store.withAgentScope(actorScope, () =>
        store
          .all(false, true)
          .map((e) =>
            e.kind === 'card'
              ? cardAccess(e)
              : e.kind === 'report'
                ? { ...e, data: { ...e.data, content: undefined, sections: undefined } }
                : e.kind === 'vault-file'
                  ? { ...e, data: { ...e.data, content: undefined } }
                  : e.kind === 'connection'
                    ? { ...e, data: { ...e.data, enabled: connections.clients.has(e.id) } }
                    : e,
          ),
      ),
      desktop: true,
      showOnboarding:
        (process.env.INTELLIGENCE_TEST !== '1' || setupFixture) &&
        store.firstRun &&
        !setupInvitationOffered &&
        store.settings().onboarding.status === 'not-started' &&
        !store.settings().onboardingComplete &&
        (setupInvitationOffered = true),
      memoryStatus: memory.status,
      consolidationStatus: consolidator.status,
      matrixActive: matrix.running ? { ...matrix.running } : null,
      matrixPreparation: matrix.preparation
        ? { task: matrix.preparation.task, list: matrix.preparation.list }
        : null,
      activeConversations: [...agent.active.keys()],
      temporaryAccess: agent.accessRequests.status(),
      approvals: [...agent.approvals.values()].map(({ resolve, ...event }) => event),
      search: webSearch.status(),
      inference: {
        providers: inferenceProviders,
        key: inferenceCredentials.info(store.settings()),
      },
      machine: await machineIdentity(),
    };
  });
  handle('mutate', (input) => {
    const previousCard = store.get(input.id);
    if (
      previousCard?.kind === 'card' &&
      input.data?.status === 'queued' &&
      previousCard.data.status !== 'queued'
    )
      input = {
        ...input,
        data: {
          ...input.data,
          approvedMissedStart:
            input.data.schedule?.start ?? previousCard.data.schedule?.start ?? null,
        },
      };
    if (store.get(input.id, true)?.kind.startsWith('vault-')) {
      const result =
        input.action === 'trash'
          ? vault.trash(input.id)
          : input.action === 'restore'
            ? vault.restore(input.id)
            : vault.update(input);
      change();
      return result;
    }
    const e = store.mutate(input);
    if (e.kind.startsWith('matrix-') && matrix.affectsRun(e.id))
      matrix.stop(
        input.data?.integrated === false
          ? 'Matrix integration was paused.'
          : 'Task context changed during execution. Review progress and retry.',
        input.data?.integrated === false ? 'paused' : 'needs_input',
      );
    if (!input.id && e.kind === 'matrix-task') {
      const parent = store.get(e.parent);
      if (parent?.kind === 'matrix-task' && parent.data.status === 'done')
        store.mutate({
          id: parent.id,
          data: {
            status: 'needs_input',
            result: 'A new subtask was added. Queue it when its details are ready.',
          },
        });
    }
    change();
    void memory.index().catch(() => {});
    return e;
  });
  handle('settings', (input) => {
    const previousModules = store.settings().optionalModules;
    if (input.backgroundPaused !== undefined) setBackgroundPaused(input.backgroundPaused);
    const s = store.setSettings(input);
    if (input.optionalModules)
      for (const id of ['tts', 'stt', 'zim'])
        if (JSON.stringify(previousModules?.[id]) !== JSON.stringify(s.optionalModules?.[id]))
          optionalModules.stop(id);
    planning.reconcile();
    if (input.wakeForTasks !== undefined) {
      try {
        updateWake(store);
      } catch (e) {
        emit({ type: 'notice', error: e.message });
      }
    }
    if (input.externalEventsEnabled !== undefined || input.externalEventsPort !== undefined)
      void externalEvents.refresh().catch((e) => emit({ type: 'notice', error: e.message }));
    if (input.language !== undefined) rebuildTray();
    if (input.appIcon !== undefined || input.trayIcon !== undefined) updateIcons(s);
    if (input.approvalMode !== undefined || input.askDestructive !== undefined)
      agent.applyApprovalMode();
    agent.commandListener();
    if (input.semanticSearch === false)
      void memory.release().catch((error) => console.error('Memory cleanup:', error));
    if (!s.autoConsolidation || !s.memoryAccess) consolidator.pause();
    if (input.matrixPollSeconds !== undefined) matrix.start();
    if (!s.matrixAccess) matrix.stop('Matrix access was disabled.');
    if (!s.tools) matrix.stop('Agent tools were disabled.');
    change();
    return s;
  });
  handle('messages', (id) => store.messages(id));
  handle('copy', (text) => {
    if (typeof text !== 'string' || text.length > 4000000) throw Error('Invalid clipboard text');
    clipboard.writeText(text);
  });
  handle('chat-info', (id) => agent.context.info(id));
  handle('compact', async (id) => {
    if (agent.active.has(id)) throw Error('Wait for this response to finish before compacting.');
    const controller = new AbortController();
    agent.active.set(id, controller);
    if (matrix.running)
      matrix.stop(
        'Foreground compaction interrupted this run. Review progress and retry.',
        'needs_input',
      );
    matrix.refresh();
    try {
      return await agent.context.compact(id, { signal: controller.signal });
    } finally {
      agent.active.delete(id);
      change();
    }
  });
  handle('history', (id) => store.history(id));
  handle('search', (query) => store.search(query));
  handle('models', (profile, force = false) => {
    if (profile) validateMatrixProfile({ ...profile, model: profile.model || 'discovery' });
    const settings = matrixInference(
      store.settings(),
      profile ? { ...profile, model: profile.model || 'discovery' } : null,
    );
    const cacheKey =
      settings.provider +
      ':' +
      settings.endpoint +
      ':' +
      inferenceCredentials.info(settings).generation;
    const cached = modelCatalogs.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < 30000) return cached.models;
    if (modelRequests.has(cacheKey)) return modelRequests.get(cacheKey);
    const request = listModels(settings, { key: inferenceCredentials.get(settings) })
      .then((models) => {
        modelCatalogs.set(cacheKey, { at: Date.now(), models });
        while (modelCatalogs.size > 16) modelCatalogs.delete(modelCatalogs.keys().next().value);
        return models;
      })
      .finally(() => modelRequests.delete(cacheKey));
    modelRequests.set(cacheKey, request);
    return request;
  });
  handle('model-test', async ({ action, id }) => {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(id))
      throw Error('Invalid connection test');
    if (action === 'cancel') {
      connectionTests.get(id)?.abort();
      return true;
    }
    if (action !== 'test') throw Error('Unknown connection test');
    for (const controller of connectionTests.values()) controller.abort();
    connectionTests.clear();
    const controller = new AbortController();
    connectionTests.set(id, controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    const settings = store.settings();
    const key = inferenceCredentials.get(settings);
    const generation = inferenceCredentials.info(settings).generation;
    try {
      const response = await completion(
        { ...settings, tools: false, apiMaxTokens: 256 },
        [{ role: 'user', content: 'Reply with a short greeting. This is a connection test.' }],
        [],
        () => {},
        controller.signal,
        { key },
      );
      if (controller.signal.aborted) throw Error('Connection test cancelled');
      const current = store.settings();
      if (
        settings.provider !== current.provider ||
        settings.endpoint !== current.endpoint ||
        settings.model !== current.model ||
        generation !== inferenceCredentials.info(current).generation
      )
        throw Error('The connection changed. Test the current model again.');
      if (!response.content?.trim())
        throw Error('The model returned no text. Choose another model or retry.');
      return { provider: settings.provider, model: settings.model, replied: true };
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Connection test cancelled or timed out. Your settings are saved.'
        : String(error.message).slice(0, 1500);
      throw Error(key ? message.replaceAll(key, '[redacted]') : message);
    } finally {
      clearTimeout(timer);
      if (connectionTests.get(id) === controller) connectionTests.delete(id);
    }
  });
  handle('inference-key', ({ action, key, provider, endpoint }) => {
    if (!['save', 'remove', 'status', 'disconnect'].includes(action))
      throw Error('Unknown credential action');
    if (action === 'disconnect') {
      const result = disconnectProvider(store, inferenceCredentials, provider);
      for (const [id, run] of agent.runProfiles) if (run.provider === provider) agent.stop(id);
      modelCatalogs.clear();
      change();
      return result;
    }
    const settings = store.settings();
    if (
      (provider && provider !== settings.provider) ||
      (endpoint && endpoint !== settings.endpoint)
    )
      throw Error('The connection changed. Enter the key again for the current address.');
    const result =
      action === 'save'
        ? inferenceCredentials.save(settings, key)
        : action === 'remove'
          ? inferenceCredentials.forget(settings)
          : inferenceCredentials.info(settings);
    if (action === 'save' || action === 'remove') {
      for (const controller of connectionTests.values()) controller.abort();
      for (const [id, run] of agent.runProfiles)
        if (run.provider === settings.provider && run.endpoint === settings.endpoint)
          agent.stop(id);
      modelCatalogs.clear();
    }
    change();
    return result;
  });
  handle('chat', (request) => {
    validateChatImages(store, request.images ?? []);
    if (typeof request.text !== 'string' || request.text.length > 100000)
      throw new Error('Message is too long');
    if (agent.active.has(request.conversation)) {
      if (request.images?.length)
        throw Error('Send steering as text; attach images after the response finishes.');
      return agent.steer(request.conversation, request.text);
    }
    if (!profileSettings(store, store.get(request.conversation)).model)
      throw new Error('Choose a model before chatting');
    if (agent.active.has(request.conversation))
      throw new Error('This conversation is already responding');
    if (!store.get(request.conversation)) throw new Error('Conversation not found');
    if (!Array.isArray(request.context) || request.context.length > 32)
      throw new Error('Choose at most 32 context items');
    const matrixTask = store.get(request.conversation)?.data.matrixTask;
    if (matrixTask) {
      if (request.images?.length)
        throw new Error('Attach images to the Matrix task before replying');
      matrix.reply(matrixTask, request.text);
      return { queued: true, started: false };
    }
    if (matrix.running)
      matrix.stop(
        'Foreground chat interrupted this run. Review progress and retry.',
        'needs_input',
      );
    // Only the native Matrix runner may select a per-run inference profile.
    if (planning.running) planning.stop();
    const { inference: _ignoredInference, ...chatRequest } = request;
    void agent.chat(chatRequest).catch(() => {});
    return { started: true };
  });
  handle('stop', (id) => {
    if (matrix.running?.conversation === id) matrix.stop();
    agent.stop(id);
    return true;
  });
  handle('access-revoke', ({ conversation, id }) => agent.accessRequests.revoke(conversation, id));
  handle('approve', (id, value) => {
    agent.approve(id, value);
    return true;
  });
  handle('image', importImage);
  handle('vault', async (input) => {
    let result;
    if (input.action === 'list') return vault.list(input);
    if (input.action === 'read') return vault.read(input.id);
    if (input.action === 'create') result = vault.create(input);
    else if (input.action === 'reorder') result = vault.reorder(input);
    else if (input.action === 'save' || input.action === 'move' || input.action === 'permission')
      result = vault.update(input);
    else if (input.action === 'trash') result = vault.trash(input.id);
    else if (input.action === 'restore') result = vault.restore(input.id);
    else if (input.action === 'image') {
      const selection = await dialog.showOpenDialog(window, {
        title: localized('Choose an image', store.settings().language),
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
        properties: ['openFile'],
      });
      return selection.canceled ? null : vault.image(selection.filePaths[0]);
    } else if (input.action === 'import') {
      const selection = await dialog.showOpenDialog(window, {
        title: localized('Import Markdown', store.settings().language),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        properties: ['openFile', 'multiSelections'],
      });
      if (selection.canceled) return [];
      if (selection.filePaths.length > 25)
        throw new Error('Import at most 25 Markdown files at once');
      result = selection.filePaths.map((source) => {
        if (fsSync.statSync(source).size > 1024 * 1024)
          throw new Error('Markdown files must be smaller than 1 MB');
        return vault.create({
          parent: input.parent ?? null,
          title: path.basename(source),
          content: fsSync.readFileSync(source, 'utf8'),
        });
      });
    } else throw new Error('Unknown Vault action');
    change();
    return result;
  });
  handle('export', exportNotebook);
  handle('directory', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: localized('Choose a project directory', store.settings().language),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('project', async ({ title, directory, create }) => {
    if (!title?.trim()) throw new Error('Give your project a name');
    if (create) {
      const base = path.join(os.homedir(), 'Intelligence', 'Projects');
      directory = path.join(
        base,
        title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) + '-' + randomUUID().slice(0, 6),
      );
      await fs.mkdir(directory, { recursive: true });
    }
    if (
      !directory ||
      !path.isAbsolute(directory) ||
      (await fs.stat(directory)).isDirectory() !== true
    )
      throw new Error('Choose an existing directory');
    const entity = store.mutate({ kind: 'project', title, data: { directory, access: true } });
    change();
    return entity;
  });
  handle('system', () => inspectMachine());
  handle('containers', () => inspectContainers());
  handle('logs', (options) => readLogs(options));
  handle('machine-prepare', async () => {
    const report = await inspectMachine();
    const existing = store.all(false, true).find((e) => e.kind === 'machine');
    const profile = store.mutate({
      id: existing?.id,
      kind: 'machine',
      title: report.displayName,
      data: machineProfileData(report),
    });
    change();
    return profile;
  });
  handle('memory-enable', () => {
    store.setSettings({ semanticSearch: true });
    change();
    void memory.enable().catch(() => {});
    return true;
  });
  handle('memory-search', (query, options) =>
    memory.search(query, options?.memoriesOnly ? { kind: 'memory', limit: 30 } : {}),
  );
  handle('memory-inspect', (id) => store.inspectMemory(id));
  handle('memory-resolve', (id) => {
    store.resolveMemory(id);
    change();
  });
  handle('connect', async (id) => {
    const result = await connections.connect(id);
    store.mutate({ id, data: { enabled: true } });
    change();
    return result;
  });
  handle('disconnect', async (id) => {
    await connections.disconnect(id);
    store.mutate({ id, data: { enabled: false } });
    change();
    return true;
  });
  handle('window', (action) => {
    if (action === 'quit') {
      quitting = true;
      app.quit();
    }
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
    return true;
  });
  handle('task-run', (id) => {
    void runTask(id, true).catch((e) => emit({ type: 'notice', error: e.message }));
    return true;
  });
  handle('task-stop', (id) => {
    const task = store.get(id);
    if (task?.data.conversation) agent.stop(task.data.conversation);
    store.mutate({ id, data: { status: 'paused' } });
    change();
    return true;
  });
  handle('task-complete', (id) => {
    const task = store.get(id);
    if (!task || task.kind !== 'card') throw new Error('Task not found');
    const next = nextOccurrence(task.data.schedule);
    store.mutate({
      id,
      data: next
        ? {
            status: 'queued',
            lastCompletedAt: new Date().toISOString(),
            schedule: { ...task.data.schedule, start: next },
          }
        : { status: 'done', completedAt: new Date().toISOString(), assigned: false },
    });
    change();
    return true;
  });
  handle('trash', () => store.all(true).filter((e) => e.deleted));
  handle('search-provider', async ({ action, key, provider, query }) => {
    if (action === 'status') return webSearch.status();
    if (action === 'save-key') {
      const result = searchCredentials.save(key);
      change();
      return result;
    }
    if (action === 'forget-key') {
      const result = searchCredentials.forget();
      change();
      return result;
    }
    if (action === 'test')
      return webSearch.search({ query: query ?? 'Intelligence search connection' });
    if (action === 'open-setup') {
      const definition = webSearch.status().providers.find((e) => e.id === provider);
      if (!definition) throw new Error('Choose a supported search provider');
      await shell.openExternal(definition.setupUrl);
      return true;
    }
    throw new Error('Unknown search provider action');
  });
  handle('matrix-action', async ({ action, id, content }) => {
    const task = store.get(id);
    if (action === 'retry') matrix.queue(id);
    else if (action === 'complete') {
      if (task?.kind !== 'matrix-task' || matrix.running?.task === id)
        throw new Error('Stop the task before completing it');
      if (
        store.children(id, true).some((e) => e.kind === 'matrix-task' && e.data.status !== 'done')
      )
        throw new Error('Complete the subtasks first');
      store.mutate({
        id,
        data: {
          status: 'done',
          result: 'Marked complete by you.',
          verification: 'User reviewed the task.',
          completedAt: new Date().toISOString(),
        },
      });
    } else if (action === 'reply') matrix.reply(id, content);
    else if (action === 'pause') {
      if (matrix.running?.task === id) matrix.stop();
      else if (task?.kind === 'matrix-task') store.mutate({ id, data: { status: 'paused' } });
      else throw new Error('Matrix task not found');
    } else if (action === 'clear-attention') {
      if (task?.kind !== 'matrix-list') throw new Error('Matrix list not found');
      const blocked = store.get(task.data.attention?.task);
      if (blocked?.kind === 'matrix-task' && blocked.data.status === 'needs_input')
        matrix.queue(blocked.id);
      store.mutate({ id, data: { attention: null } });
    } else if (action === 'conversation') {
      if (task?.kind !== 'matrix-task') throw new Error('Matrix task not found');
      const existing = store.get(task.data.conversation);
      if (existing) return existing;
      const conversation = store.mutate({
        kind: 'conversation',
        title: 'Matrix · ' + task.title,
        data: { matrixTask: id, context: [id], memoryExcluded: true },
        project: null,
      });
      store.mutate({ id, data: { conversation: conversation.id } });
      change();
      return conversation;
    } else throw new Error('Unknown Matrix action');
    change();
    return true;
  });
  handle('matrix-attach', async (id) => {
    if (store.get(id)?.kind !== 'matrix-task') throw new Error('Matrix task not found');
    const result = await dialog.showOpenDialog(window, {
      title: 'Attach files or images to task',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    const files = [];
    try {
      for (const source of result.filePaths) files.push(await matrix.files.import(id, source));
      return files;
    } finally {
      if (files.length && matrix.affectsRun(id))
        matrix.stop('Attachments changed during execution. Review and retry.', 'needs_input');
      change();
    }
  });
  handle('matrix-open-file', async (id) => {
    const result = await shell.openPath(await matrix.files.path(id, false));
    if (result) throw new Error(result);
    return true;
  });
  handle('matrix-export-file', async (id) => {
    const source = await matrix.files.path(id, false),
      file = store.get(id);
    const result = await dialog.showSaveDialog(window, {
      title: 'Save attachment copy',
      defaultPath: path.join(app.getPath('documents'), file.title),
    });
    if (result.canceled || !result.filePath) return null;
    if (!path.isAbsolute(result.filePath)) throw new Error('Choose an absolute file path');
    await fs.copyFile(source, result.filePath);
    return result.filePath;
  });
  const deleteOneTrash = async (id) => {
    const item = store.get(id, true);
    const subtree = item ? [item, ...store.children(id, true, true)] : [];
    const ids = new Set(subtree.map((e) => e.id));
    if (
      [...agent.active.keys()].some((conversation) => ids.has(conversation)) ||
      store.db
        .prepare("SELECT card,conversation FROM runs WHERE status='running'")
        .all()
        .some((run) => ids.has(run.card) || ids.has(run.conversation))
    )
      throw new Error('Stop the active task or conversation before deleting it');
    consolidator.pause();
    const vaultAssets = store.get(id, true)?.kind.startsWith('vault-') ? vault.destroy(id) : null;
    const result = store.deleteTrash(id);
    await agent.chatFiles.collect();
    result.retainedAssets += vault.collectAssets(vaultAssets);
    change();
    return result;
  };
  handle('trash-delete', (id) =>
    Array.isArray(id) ? deleteTrashBatch(store, id, deleteOneTrash) : deleteOneTrash(id),
  );
}
async function runTask(id, manual = false) {
  const profile = requireAssignedAgent(store, store.get(id));
  return store.withAgentScope(
    agent.accessRequests.scope(
      profileSettings(store, { data: { agentProfile: profile } }),
      'task-start',
    ),
    () => runTaskScoped(id, manual),
  );
}
async function runTaskScoped(id, manual = false) {
  const card = store.get(id);
  if (!card || card.kind !== 'card') throw new Error('Task not found');
  if (!store.access(id, true)) throw new Error('Enable read & edit access for this card first.');
  if (!manual && !store.assigned(id)) return;
  if (card.data.status === 'running') return;
  if (agent.active.size)
    throw new Error('Finish or stop the active response before starting another task.');
  const assignedProfile = requireAssignedAgent(store, card);
  const taskSettings = profileSettings(store, { data: { agentProfile: assignedProfile } });
  if (!taskSettings.model)
    throw new Error('Choose a model for the assigned agent before starting this task.');
  if (manual && !store.assigned(id)) store.mutate({ id, data: { assigned: true } });
  const conversation = store.mutate({
    kind: 'conversation',
    title: card.title,
    project: card.project,
    data: {
      context: [id, ...(card.data.links ?? [])],
      task: id,
      agentProfile: assignedProfile,
    },
  });
  const runId = randomUUID();
  store.db
    .prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)')
    .run(runId, id, 'running', new Date().toISOString(), null, null, conversation.id);
  store.db
    .prepare('INSERT INTO run_profiles VALUES(?,?,?,?,?)')
    .run(runId, assignedProfile, taskSettings.agentName, taskSettings.provider, taskSettings.model);
  store.mutate({
    id,
    data: {
      status: 'running',
      conversation: conversation.id,
      lastRun: new Date().toISOString(),
      lastAgent: assignedProfile,
      lastModel: taskSettings.model,
      lastProvider: taskSettings.provider,
    },
  });
  change();
  const maxMinutes = Math.max(1, Math.min(Number(card.data.schedule?.maxMinutes ?? 30), 480));
  const timer = setTimeout(() => agent.stop(conversation.id), maxMinutes * 60000);
  let result, status;
  try {
    await agent.chat({
      conversation: conversation.id,
      text: `Work on this assigned task: ${card.title}\n${card.data.content ?? ''}\nCompletion criteria: ${card.data.criteria ?? 'Provide the requested deliverable and describe verification.'}\nRecord the outcome with task_result.`,
      context: [id, ...(card.data.links ?? [])],
      task: id,
    });
    status = store.get(id)?.data.status === 'review' ? 'review' : 'needs_input';
    result = store.get(id)?.data.result ?? 'Check the task conversation before continuing.';
  } catch (e) {
    status = store.get(id)?.data.status === 'paused' ? 'paused' : 'needs_input';
    result = e.message;
  } finally {
    clearTimeout(timer);
  }
  if (store.get(id)) store.mutate({ id, data: { status, result } });
  else if (store.get(id, true))
    store.db
      .prepare(
        "UPDATE entities SET data=json_set(data,'$.status',?,'$.result',?),revision=revision+1 WHERE id=?",
      )
      .run(status, result, id);
  store.db
    .prepare('UPDATE runs SET status=?,end=?,result=? WHERE id=?')
    .run(status, new Date().toISOString(), result, runId);
  change();
}
async function tick() {
  if (scheduling) return;
  planning.reminders();
  if (agent.active.size) return;
  scheduling = true;
  try {
    if (store.settings().backgroundPaused) {
      await planning.tick();
      return;
    }
    for (const c of store.all(false, true).filter((e) => e.kind === 'card')) {
      if (!store.assigned(c.id)) continue;
      let chosen;
      try {
        chosen = requireAssignedAgent(store, c);
      } catch (error) {
        if (c.data.status !== 'needs_input')
          store.mutate({ id: c.id, data: { status: 'needs_input', result: error.message } });
        continue;
      }
      if (
        !store.withAgentScope(
          agent.accessRequests.scope(
            profileSettings(store, { data: { agentProfile: chosen } }),
            'task-start',
          ),
          () => store.assigned(c.id),
        ) ||
        ['running', 'review', 'needs_input', 'paused', 'done'].includes(c.data.status)
      )
        continue;
      const start = c.data.schedule?.start;
      if (!start || Date.parse(start) > Date.now()) continue;
      if (!profileSettings(store, { data: { agentProfile: chosen } }).model) {
        store.mutate({
          id: c.id,
          data: {
            status: 'needs_input',
            result: 'Choose a local model, then queue this task again.',
          },
        });
        change();
        continue;
      }
      if (Date.now() - Date.parse(start) > 3600000 && c.data.approvedMissedStart !== start) {
        if (store.settings().missedTaskPolicy === 'run') {
          await runTask(c.id);
          break;
        }
        if (store.settings().missedTaskPolicy === 'skip') {
          const next = nextOccurrence(c.data.schedule);
          store.mutate({
            id: c.id,
            data: {
              status: next ? 'queued' : 'done',
              ...(next ? { schedule: { ...c.data.schedule, start: next } } : {}),
              result: 'Missed occurrence skipped by your scheduling policy.',
            },
          });
          change();
          continue;
        }
        store.mutate({
          id: c.id,
          data: {
            status: 'needs_input',
            result: 'This starting time was missed. Run this task when you are ready.',
          },
        });
        change();
        continue;
      }
      await runTask(c.id);
      break;
    }
    if (!agent.active.size && !matrix.running) await planning.tick();
  } catch (e) {
    emit({ type: 'notice', error: e.message });
  } finally {
    scheduling = false;
  }
}
await app.whenReady();
store = new Store(process.env.INTELLIGENCE_DATA_DIR ?? app.getPath('userData'));
store.on('changed', ({ entity }) => {
  if (entity && entity.kind !== 'conversation') change();
});
if (store.firstRun && (process.env.INTELLIGENCE_TEST !== '1' || setupFixture))
  store.setSettings({
    semanticSearch: false,
    autoConsolidation: false,
    memoryAccess: false,
    background: false,
    matrixPreload: false,
    shareName: false,
  });
ensureProfiles(store);
if (store.firstRun && (process.env.INTELLIGENCE_TEST !== '1' || setupFixture))
  store.mutate({
    id: store.settings().activeAgent,
    data: { resourcePolicy: 'ask', resourceGrants: [], allowConfigurationRequests: true },
  });
ensureBuiltinSkills(store);
vault = new Vault(store);
workspace = new Workspace(store, vault);
memory = new Memory(store, emit);
connections = new Connections(store);
agent = new Agent(store, memory, connections, emit);
await agent.chatFiles.collect();
planning = new Planning(store, agent, emit);
workspace.planning = planning;
agent.planning = planning;
agent.vault = vault;
searchCredentials = new SearchCredentials(store, safeStorage);
inferenceCredentials = new InferenceCredentials(store, safeStorage);
agent.providerRuntime = (settings) => {
  requireConnectedProvider({
    ...settings,
    connectedProviders: store.settings().connectedProviders,
  });
  return { key: inferenceCredentials.get(settings) };
};
agent.context = new ContextManager(store, (settings) => agent.providerRuntime(settings), emit);
webSearch = new WebSearch(store, { credentials: searchCredentials });
agent.webSearch = webSearch;
const speechCredentials = new Map();
optionalModules = new OptionalModules(store, emit, {
  credentials: (id) => {
    optionalModules?.definition(id);
    const endpoint = store.settings().optionalModules?.[id]?.endpoint || '';
    if (!endpoint) return null;
    const namespace = 'speech:' + id + ':' + new URL(endpoint).href;
    if (!speechCredentials.has(namespace))
      speechCredentials.set(
        namespace,
        new SearchCredentials(store, safeStorage, process.platform, namespace),
      );
    return speechCredentials.get(namespace);
  },
});
agent.optionalModules = optionalModules;
consolidator = new Consolidator(store, emit, { busy: () => agent.active.size > 0 });
matrix = new CognitionMatrix(store, agent, emit);
externalEvents = new ExternalEvents(
  store,
  new SearchCredentials(store, safeStorage, process.platform, 'external-events'),
  (channel) => matrix.triggers.external(channel),
  emit,
);
void externalEvents.refresh().catch((e) => emit({ type: 'notice', error: e.message }));
agent.matrix = matrix;
memory.pauseConsolidation = () => consolidator.pause();
// A crashed model request cannot be resumed by blindly replaying its side effects.
for (const card of store
  .all(false, true)
  .filter((e) => e.kind === 'card' && e.data.status === 'running'))
  store.mutate({
    id: card.id,
    data: {
      status: 'needs_input',
      result: 'The previous run was interrupted. Review its conversation before retrying.',
    },
  });
protocol.handle('intelligence-media', async (request) => {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'vault') {
      const file = vault.imagePath(url.pathname.slice(1));
      return new Response(await fs.readFile(file), {
        headers: {
          'Content-Type':
            path.extname(file) === '.jpg' ? 'image/jpeg' : 'image/' + path.extname(file).slice(1),
          'Cache-Control': 'no-cache',
        },
      });
    }
    if (url.hostname === 'matrix' && /^\/[a-f0-9-]+$/i.test(url.pathname)) {
      const id = url.pathname.slice(1),
        file = store.get(id);
      const bytes = await fs.readFile(await matrix.files.path(id, false));
      return new Response(bytes, {
        headers: { 'Content-Type': file.data.mime, 'Cache-Control': 'no-cache' },
      });
    }
    if (url.hostname !== 'asset' || !/^\/[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(url.pathname))
      return new Response('Not found', { status: 404 });
    const file = path.join(store.directory, 'assets', url.pathname.slice(1));
    const bytes = await fs.readFile(file);
    const ext = path.extname(file);
    return new Response(bytes, {
      headers: {
        'Content-Type': ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.slice(1)}`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
});
const savedWindow = restoreWindow(
  store.settings().windowBounds,
  [
    screen.getPrimaryDisplay(),
    ...screen.getAllDisplays().filter((d) => d.id !== screen.getPrimaryDisplay().id),
  ].map((d) => d.workArea),
);
window = new BrowserWindow({
  width: Math.round(savedWindow.width),
  height: Math.round(savedWindow.height),
  x: Math.round(savedWindow.x),
  y: Math.round(savedWindow.y),
  minWidth: Math.min(820, savedWindow.width),
  minHeight: Math.min(600, savedWindow.height),
  show: process.env.INTELLIGENCE_TEST !== '1',
  frame: false,
  backgroundColor: '#111614',
  icon: iconImage(store.settings().appIcon, 256),
  webPreferences: {
    backgroundThrottling: process.env.INTELLIGENCE_TEST !== '1',
    preload: path.join(root, 'electron', 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  },
});
if (savedWindow.maximized) window.maximize();
let windowSaveTimer;
const saveWindow = () => {
  clearTimeout(windowSaveTimer);
  if (!window.isDestroyed())
    store.setSettings({
      windowBounds: { ...window.getNormalBounds(), maximized: window.isMaximized() },
    });
};
for (const event of ['resize', 'move', 'maximize', 'unmaximize'])
  window.on(event, () => {
    clearTimeout(windowSaveTimer);
    windowSaveTimer = setTimeout(saveWindow, 250);
  });
window.on('close', saveWindow);
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('context-menu', (_event, params) => {
  const items = params.isEditable
    ? [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ]
    : params.selectionText
      ? [{ role: 'copy' }, { role: 'selectAll' }]
      : [];
  const labels = {
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
  };
  for (const item of items)
    if (item.role && labels[item.role])
      item.label = localized(labels[item.role], store.settings().language);
  if (items.length) Menu.buildFromTemplate(items).popup({ window });
});
window.webContents.on('will-navigate', (event, url) => {
  const allowed = process.env.INTELLIGENCE_DEV_URL ?? 'file://';
  if (!url.startsWith(allowed)) event.preventDefault();
});
window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
  callback(
    contents === window.webContents &&
      details.isMainFrame &&
      permission === 'media' &&
      details.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === 'audio' &&
      store.settings().optionalModules?.stt?.enabled &&
      [...optionalModules.sessions.values()].some((session) => session.id === 'stt'),
  ),
);
window.webContents.session.setPermissionCheckHandler(
  (contents, permission, _origin, details) =>
    contents === window.webContents &&
    details.isMainFrame &&
    permission === 'media' &&
    details.mediaType === 'audio' &&
    [...optionalModules.sessions.values()].some((session) => session.id === 'stt'),
);
setup();
if (process.env.INTELLIGENCE_DEV_URL) await window.loadURL(process.env.INTELLIGENCE_DEV_URL);
else await window.loadFile(path.join(root, 'dist', 'index.html'));
window.on('close', (event) => {
  if (
    !quitting &&
    ((store.settings().background && tray) || matrix.lists().some((list) => list.data.integrated))
  ) {
    event.preventDefault();
    window.hide();
  }
});
if (process.env.INTELLIGENCE_TEST !== '1')
  try {
    const icon = iconImage(store.settings().trayIcon, 24);
    if (icon.isEmpty()) throw new Error(`Could not load tray icon: ${iconPath}`);
    tray = new Tray(icon.resize({ width: 24, height: 24 }));
    tray.setToolTip('Intelligence');
    rebuildTray();
    tray.on('click', () => window.show());
  } catch (error) {
    tray?.destroy();
    tray = null;
    console.error('Failed to create Intelligence tray:', error);
  }
const scheduler = setInterval(tick, 15000);
matrix.start();
const memoryScheduler = setInterval(() => void consolidator.tick(), 30000);
powerMonitor.on('resume', () => {
  matrix.refresh();
  void tick();
  change();
});
powerMonitor.on('suspend', () => {
  planning.stop();
  consolidator.pause();
  matrix.preparation?.controller.abort();
  if (matrix.running)
    matrix.stop('Sleep interrupted this task. Review progress before retrying.', 'needs_input');
});
app.on('before-quit', () => {
  saveWindow();
  quitting = true;
  workspace.close();
  planning.close();
  void externalEvents.close();
  clearInterval(scheduler);
  clearInterval(memoryScheduler);
  consolidator.close();
  void memory.close().catch(() => {});
  matrix.close();
  for (const id of agent.active.keys()) agent.stop(id);
  agent.commands.close();
  void connections.close();
});
app.on('window-all-closed', () => app.quit());
