const { contextBridge, ipcRenderer } = require('electron');
const invoke =
  (name) =>
  (...args) =>
    ipcRenderer.invoke('intelligence:' + name, ...args);
contextBridge.exposeInMainWorld('intelligence', {
  bootstrap: invoke('bootstrap'),
  workspace: invoke('workspace'),
  mutate: invoke('mutate'),
  settings: invoke('settings'),
  messages: invoke('messages'),
  history: invoke('history'),
  search: invoke('search'),
  models: invoke('models'),
  copy: invoke('copy'),
  compact: invoke('compact'),
  chatInfo: invoke('chat-info'),
  inferenceKey: invoke('inference-key'),
  vault: invoke('vault'),
  chat: invoke('chat'),
  stop: invoke('stop'),
  approve: invoke('approve'),
  image: invoke('image'),
  export: invoke('export'),
  directory: invoke('directory'),
  project: invoke('project'),
  system: invoke('system'),
  prepareMachine: invoke('machine-prepare'),
  containers: invoke('containers'),
  logs: invoke('logs'),
  memoryEnable: invoke('memory-enable'),
  memorySearch: invoke('memory-search'),
  memoryInspect: invoke('memory-inspect'),
  memoryResolve: invoke('memory-resolve'),
  connect: invoke('connect'),
  disconnect: invoke('disconnect'),
  window: invoke('window'),
  runTask: invoke('task-run'),
  stopTask: invoke('task-stop'),
  trash: invoke('trash'),
  deleteTrash: invoke('trash-delete'),
  matrixAction: invoke('matrix-action'),
  matrixAttach: invoke('matrix-attach'),
  matrixOpenFile: invoke('matrix-open-file'),
  matrixExportFile: invoke('matrix-export-file'),
  searchProvider: invoke('search-provider'),
  completeTask: invoke('task-complete'),
  onEvent: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('intelligence:event', listener);
    return () => ipcRenderer.removeListener('intelligence:event', listener);
  },
});
