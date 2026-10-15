export type Kind =
  | 'notebook'
  | 'chapter'
  | 'note'
  | 'board'
  | 'list'
  | 'card'
  | 'project'
  | 'memory'
  | 'skill'
  | 'connection'
  | 'machine'
  | 'conversation'
  | 'agent-profile'
  | 'calendar'
  | 'calendar-event'
  | 'report-template'
  | 'report'
  | 'matrix-list'
  | 'matrix-task'
  | 'matrix-file'
  | 'matrix-entry'
  | 'vault-folder'
  | 'vault-file';
// Vault documents are real Markdown files.
// Matrix items are global workspace entities.
export type Entity = {
  agentAccess?: boolean;
  agentEditable?: boolean;
  agentAssigned?: boolean;
  id: string;
  kind: Kind;
  title: string;
  parent: string | null;
  project: string | null;
  revision: number;
  data: Record<string, any>;
  deleted: boolean;
  created: string;
  updated: string;
};
export type Settings = {
  lastProject: string;
  computerScope: 'projects' | 'folders' | 'system';
  computerFolders: { directory: string; permission: 'read' | 'edit' }[];
  askDestructive: boolean;
  windowBounds: { x?: number; y?: number; width?: number; height?: number; maximized?: boolean };
  skillLearning: 'automatic' | 'review' | 'off';
  preferredName: string;
  profileDescription: string;
  profilePhoto: string;
  shareProfile: boolean;
  optionalModules: Record<
    string,
    {
      enabled?: boolean;
      adapter?: string;
      endpoint?: string;
      model?: string;
      voice?: string;
      directory?: string;
      engine?: 'piper' | 'kokoro';
      localVoice?: string;
      recognitionModel?: 'fast' | 'larger';
    }
  >;
  shareName: boolean;
  calendarAccess: boolean;
  reportsAccess: boolean;
  reportsAutomation: boolean;
  reportAnimations: boolean;
  reportImages: boolean;
  reportPresentation: 'quiet' | 'notify' | 'present';
  calendarMode: 'personal' | 'combined' | 'agent';
  calendarView: 'agenda' | 'week' | 'month';
  calendarProfiles: string[];
  calendarLayers: string[];
  activeAgent: string;
  backgroundPaused: boolean;
  activityNotifications: boolean;
  notebookLook: 'bound' | 'paperback' | 'spiral' | 'index' | 'folio';
  decorativeBackgrounds: boolean;
  backgroundArtwork:
    | 'theme'
    | 'custom'
    | 'ink'
    | 'day'
    | 'night'
    | 'summer'
    | 'autumn'
    | 'winter'
    | 'festive'
    | 'tech'
    | 'astral'
    | 'marble';
  backgroundImage: string;
  backgroundOpacity: number;
  backgroundBlur: number;
  paneWidths: { sidebar: number; navigator: number; assistant: number };
  pinnedItems: string[];
  recentItems: { id: string; at: number }[];
  onboardingComplete: boolean;
  setupReminderDismissed?: boolean;
  onboarding?: import('../electron/onboarding.mjs').SetupProgress;
  missedTaskPolicy: 'ask' | 'skip' | 'run';
  externalEventsEnabled: boolean;
  externalEventsPort: number;
  wakeForTasks: boolean;
  chatWidth: 'comfortable' | 'wide';
  followLatest: boolean;
  showThinking: boolean;
  autoReadAloud: boolean;
  approvalMode: 'ask' | 'auto' | 'full';
  autoCompact: boolean;
  compactPercent: number;
  contextOverride: number;
  theme:
    | 'ink'
    | 'day'
    | 'night'
    | 'system'
    | 'summer'
    | 'autumn'
    | 'winter'
    | 'festive'
    | 'tech'
    | 'astral'
    | 'marble';
  returnTheme:
    | 'ink'
    | 'day'
    | 'system'
    | 'summer'
    | 'autumn'
    | 'winter'
    | 'festive'
    | 'tech'
    | 'astral'
    | 'marble';
  layout: 'studio';
  skillsView: 'cards' | 'list';
  appIcon: 'original' | 'prism' | 'aurora';
  trayIcon: 'original' | 'prism' | 'aurora';
  logoIcon: 'original' | 'prism' | 'aurora';
  toolRepair: boolean;
  toolRepairAttempts: number;
  toolStepLimit: number;
  connectedProviders: Settings['provider'][];
  agentName: string;
  avatar: string;
  accent: string;
  personality: string;
  systemPrompt: string;
  provider:
    | 'ollama'
    | 'lmstudio'
    | 'llamacpp'
    | 'openai'
    | 'mistral'
    | 'qwen'
    | 'openrouter'
    | 'compatible';
  language: 'en' | 'ro';
  visionEnabled: boolean;
  apiMaxTokens: number;
  providerProfiles: Record<string, { endpoint: string; model: string; visionEnabled: boolean }>;
  vaultAccess: boolean;
  vaultFont: 'inter' | 'lora' | 'garamond' | 'mono';
  vaultSort: 'manual' | 'name' | 'name-desc' | 'updated' | 'folders';
  endpoint: string;
  model: string;
  tools: boolean;
  notebookAccess: boolean;
  kanbanAccess: boolean;
  memoryAccess: boolean;
  terminalAccess: boolean;
  background: boolean;
  embeddingEnabled: boolean;
  semanticSearch: boolean;
  autoConsolidation: boolean;
  matrixAccess: boolean;
  matrixShowCompleted: boolean;
  matrixCompactRows: boolean;
  matrixPollSeconds: number;
  matrixPreload: boolean;
  matrixPreloadMinutes: number;
  matrixMaxMinutes: number;
  matrixMaxSteps: number;
  matrixScheduling: 'round-robin' | 'priority';
  matrixWorkingColor: string;
  matrixDoneColor: string;
  matrixFailedColor: string;
  matrixAttentionColor: string;
  matrixQueuedColor: string;
  searxngEndpoint: string;
  searchEnabled: boolean;
  searchProvider: string;
  searchMaxResults: number;
  searchTimeoutSeconds: number;
};
export type Snapshot = {
  showOnboarding?: boolean;
  settings: Settings;
  entities: Entity[];
  runs: any[];
  desktop?: boolean;
  memoryStatus?: string;
  consolidationStatus?: string;
  machine?: { displayName: string; hostname: string; platform: string };
  matrixActive?: { task: string; list: string; conversation: string } | null;
  matrixPreparation?: { task: string; list: string } | null;
  activeConversations?: string[];
  approvals?: AgentEvent[];
  temporaryAccess?: {
    conversation: string;
    resource: string;
    permission: string;
    profile?: string;
  }[];
  inference?: {
    providers: { id: string; name: string; endpoint: string; cloud: boolean }[];
    key: {
      configured: boolean;
      storage: string;
      persistentAvailable: boolean;
      generation?: number;
    };
  };
  search?: {
    provider: string;
    enabled: boolean;
    providers: {
      id: string;
      name: string;
      description: string;
      credential: boolean;
      setupUrl: string;
    }[];
    braveKey: { configured: boolean; storage: string; persistentAvailable: boolean };
  };
};
export type Message = {
  id: string;
  conversation: string;
  role: string;
  content: string;
  data: Record<string, any>;
  created: string;
};
export type AgentEvent = {
  type: string;
  conversation?: string;
  text?: string;
  name?: string;
  status?: string;
  error?: string;
  id?: string;
  summary?: string;
  details?: string;
  action?: {
    kind?: string;
    choices?: string[];
    requiresReview?: boolean;
    agent?: string;
    resource?: string;
    permission?: string;
    reason?: string;
    changes?: Record<string, { before: string; after: string }>;
  };
  repair?: string;
};
export interface API {
  workspace(input: Record<string, any>): Promise<any>;
  copy(text: string): Promise<void>;
  compact(id: string): Promise<any>;
  chatInfo(id: string): Promise<any>;
  bootstrap(): Promise<Snapshot>;
  mutate(input: Record<string, any>): Promise<Entity>;
  settings(input: Partial<Settings>): Promise<Settings>;
  messages(id: string): Promise<Message[]>;
  history(id: string): Promise<any[]>;
  search(query: string): Promise<Entity[]>;
  models(
    profile?: { provider: Settings['provider']; model?: string },
    refresh?: boolean,
  ): Promise<string[]>;
  inferenceKey(input: {
    action: 'save' | 'remove' | 'status' | 'disconnect';
    key?: string;
    provider?: Settings['provider'];
    endpoint?: string;
  }): Promise<any>;
  modelTest(input: { action: 'test' | 'cancel'; id: string }): Promise<any>;
  vault(input: Record<string, any>): Promise<any>;
  chat(input: any): Promise<any>;
  stop(id: string): Promise<any>;
  approve(
    id: string,
    allowed: boolean | 'temporary' | 'permanent' | 'decline' | 'save',
  ): Promise<any>;
  accessRevoke(input: { conversation: string; id: string }): Promise<any>;
  image(purpose?: string): Promise<string | null>;
  export(id: string): Promise<string | null>;
  directory(): Promise<string | null>;
  project(input: any): Promise<Entity>;
  system(): Promise<any>;
  prepareMachine(): Promise<Entity>;
  containers(): Promise<any>;
  logs(options: Record<string, any>): Promise<any>;
  memoryEnable(): Promise<any>;
  memorySearch(query: string, options?: { memoriesOnly: boolean }): Promise<Entity[]>;
  memoryInspect(id: string): Promise<{
    available: boolean;
    reason: string;
    sources: { id: string; title: string; kind: string; deleted: boolean; available: boolean }[];
    messageCount: number;
    messages: { id: string; role: string; created: string; content: string; truncated: boolean }[];
  }>;
  memoryResolve(id: string): Promise<any>;
  connect(id: string): Promise<any>;
  disconnect(id: string): Promise<any>;
  window(action: string): Promise<any>;
  runTask(id: string): Promise<any>;
  stopTask(id: string): Promise<any>;
  trash(): Promise<Entity[]>;
  deleteTrash(id: string | string[]): Promise<{
    deleted: string[];
    retainedAssets?: number;
    failed?: { id: string; error: string }[];
  }>;
  matrixAction(input: { action: string; id: string; content?: string }): Promise<any>;
  matrixAttach(id: string): Promise<Entity[]>;
  matrixOpenFile(id: string): Promise<any>;
  matrixExportFile(id: string): Promise<string | null>;
  searchProvider(input: {
    action: string;
    key?: string;
    provider?: string;
    query?: string;
  }): Promise<any>;
  completeTask(id: string): Promise<any>;
  onEvent(callback: (event: AgentEvent) => void): () => void;
}
declare global {
  interface Window {
    intelligence?: API;
  }
}
