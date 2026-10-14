import { locale } from './i18n';
import { t } from './i18n';
import { useLanguage, setLanguage } from './i18n';
import { version } from '../package.json';
import { releaseLabel } from '../electron/release-version.mjs';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, allowed, art, icons } from './api';
import type { Entity, Settings, Snapshot } from './types';
import Chat from './Chat';
import MemoryDetails from './MemoryDetails';
import { isGenericSummary } from '../electron/memory-summary.mjs';
let loadedEditor: typeof import('./Editor').default | null = null;
let editorLoad: Promise<typeof import('./Editor')> | null = null;
const preloadEditor = () =>
  editorLoad ||
  (editorLoad = import('./Editor').then((m) => {
    loadedEditor = m.default;
    return m;
  }));
const LazyEditor = lazy(preloadEditor);
function NoteEditor(props: React.ComponentProps<typeof import('./Editor').default>) {
  const Component = useRef(loadedEditor || LazyEditor).current;
  return <Component {...props} />;
}
import NotebookCover from './NotebookCover';
import { coverColor, coverColors } from './coverColors';
const Machine = lazy(() => import('./Machine'));
import TrashDialog from './TrashDialog';
const CognitionMatrix = lazy(() => import('./CognitionMatrix'));
import SettingsDialog from './SettingsDialog';
const Vault = lazy(() => import('./Vault'));
import ThemeArt from './ThemeArt';
import Icon from './Icon';
import ActionMenu from './ActionMenu';
import Switch from './Switch';
import Splitter from './Splitter';
const AgentScreen = lazy(() => import('./AgentScreen'));
import { ActivityPanel, BulkBar, Onboarding, ProjectBrowser } from './WorkspacePanels';
import { themes } from './themes';
import AppBackground from './AppBackground';
const Calendar = lazy(() => import('./Calendar'));
const ConversationLibrary = lazy(() => import('./ConversationLibrary'));
const Reports = lazy(() => import('./Reports'));
const TaskDetail = lazy(() => import('./TaskDetail'));
const ChapterContent = lazy(() => import('./ChapterContent'));
import { logoPath } from './branding';
import { useMarqueeSelection } from './Selection';

type Page =
  | 'calendar'
  | 'reports'
  | 'agent'
  | 'chat'
  | 'projects'
  | 'notebooks'
  | 'tasks'
  | 'matrix'
  | 'vault'
  | 'system'
  | 'memory'
  | 'skills'
  | 'connections';
type Form = {
  title: string;
  subtitle?: string;
  values: Record<string, string>;
  fields: {
    key: string;
    label: string;
    type?: string;
    options?: { value: string; label: string }[];
  }[];
  submit: (v: Record<string, string>) => Promise<void>;
  button?: string;
};
const glyph: Record<Page, string> = {
  calendar: '▦',
  reports: '▤',
  agent: '✳',
  chat: '◌',
  projects: '⌑',
  notebooks: '▤',
  tasks: '▥',
  matrix: '◈',
  vault: '▧',
  system: '⌘',
  memory: '◎',
  skills: '✳',
  connections: '⌁',
};
const navIcon: Record<Page, string> = {
  calendar: 'calendar',
  reports: 'files',
  agent: 'sparkles',
  chat: 'message-circle',
  projects: 'folder-open',
  notebooks: 'notebook-pen',
  vault: 'files',
  tasks: 'kanban',
  matrix: 'layers',
  system: 'monitor',
  memory: 'brain',
  skills: 'sparkles',
  connections: 'plug',
};
const names: Record<Page, string> = {
  calendar: 'Calendar',
  reports: 'Reports',
  agent: 'Agent',
  chat: 'Chat',
  projects: 'Projects',
  notebooks: 'Notebooks',
  tasks: 'Tasks',
  matrix: 'Cognition Matrix',
  vault: 'Vault',
  system: 'This device',
  memory: 'Memory',
  skills: 'Skills',
  connections: 'Connections',
};
const sectionArtwork: Record<Page, number> = {
  calendar: 2,
  reports: 4,
  agent: 5,
  chat: 0,
  projects: 7,
  notebooks: 1,
  vault: 1,
  tasks: 2,
  matrix: 2,
  system: 3,
  memory: 4,
  skills: 5,
  connections: 6,
};
const time = (s: string) =>
  new Date(s).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
function Check({
  mixed = false,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { mixed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return <input {...props} ref={ref} type="checkbox" />;
}
const Menu = ActionMenu;

export default function App() {
  useLanguage();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [page, setPage] = useState<Page>('chat'),
    [notebookId, setNotebookId] = useState<string | null>(null),
    [focusId, setFocusId] = useState<string | null>(null),
    [boardId, setBoardId] = useState<string | null>(null),
    [cardId, setCardId] = useState<string | null>(null),
    [projectId, setProjectId] = useState<string | null>(null),
    [projectBrowseRequest, setProjectBrowseRequest] = useState(0),
    [conversationId, setConversationId] = useState<string | null>(null),
    [assistantConversation, setAssistantConversation] = useState<string | null>(null),
    [assistant, setAssistant] = useState(false),
    [scope, setScope] = useState('current'),
    [settingsOpen, setSettingsOpen] = useState<string | null>(null),
    [accessOpen, setAccessOpen] = useState(false),
    [form, setForm] = useState<Form | null>(null),
    [error, setError] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(''),
    [searchResults, setSearchResults] = useState<Entity[]>([]),
    [models, setModels] = useState<string[]>([]),
    [connecting, setConnecting] = useState(false),
    [system, setSystem] = useState<any>(null),
    [trashOpen, setTrashOpen] = useState(false),
    [memoryQuery, setMemoryQuery] = useState(''),
    [memoryResults, setMemoryResults] = useState<Entity[] | null>(null),
    [editingSkill, setEditingSkill] = useState<string | null>(null),
    [focusMode, setFocusMode] = useState(false),
    [saveNotice, setSaveNotice] = useState('');
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [calendarFocus, setCalendarFocus] = useState<string | null>(null),
    [templateFocus, setTemplateFocus] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null),
    [pendingReport, setPendingReport] = useState<any>(null);
  const lastInput = useRef(0);
  useEffect(() => {
    const input = () => {
      lastInput.current = Date.now();
    };
    document.addEventListener('input', input);
    return () => document.removeEventListener('input', input);
  }, []);
  const [vaultId, setVaultId] = useState<string | null>(null);
  useEffect(
    () => setScope((old) => (old === 'all' ? old : 'current')),
    [page, cardId, focusId, notebookId, boardId, vaultId],
  );
  const [matrixFocus, setMatrixFocus] = useState<string | null>(null);
  const [assistantReport, setAssistantReport] = useState<string | null>(null);
  useEffect(() => {
    if (page !== 'reports') setAssistantReport(null);
  }, [page]);
  const [activityOpen, setActivityOpen] = useState(false),
    [guideOpen, setGuideOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pageLimit, setPageLimit] = useState(120);
  useEffect(() => setPageLimit(120), [page, projectId, notebookId, boardId]);
  const selectionAnchor = useRef<string | null>(null);
  useEffect(() => {
    setSelectedIds(new Set());
    selectionAnchor.current = null;
  }, [page, notebookId, boardId, cardId, focusId]);
  const marquee = useMarqueeSelection(
    '.app-collection',
    selectedIds,
    setSelectedIds,
    selectionAnchor,
  );
  useEffect(() => {
    if (!snapshot) return;
    const live = new Set(snapshot.entities.filter((e) => !e.deleted).map((e) => e.id));
    setSelectedIds((old) =>
      [...old].every((id) => live.has(id)) ? old : new Set([...old].filter((id) => live.has(id))),
    );
  }, [snapshot?.entities.map((e) => e.id + e.deleted).join(',')]);
  const [dragCard, setDragCard] = useState<string | null>(null);
  const [cardDrop, setCardDrop] = useState<{ list: string; before: string | null } | null>(null);
  const [dragList, setDragList] = useState<string | null>(null);
  const [listDrop, setListDrop] = useState<{ before: string | null } | null>(null);
  const clearListDrag = () => {
    setDragList(null);
    setListDrop(null);
  };
  const clearCardDrag = () => {
    setDragCard(null);
    setCardDrop(null);
  };
  useEffect(() => {
    clearCardDrag();
    clearListDrag();
  }, [page, boardId, cardId]);
  useEffect(() => {
    if (!pendingReport || pendingReport.delivery !== 'present') return;
    const timer = setTimeout(() => {
      const focused = document.activeElement;
      if (
        Date.now() - lastInput.current > 3000 &&
        !form &&
        !settingsOpen &&
        !guideOpen &&
        !focusMode &&
        !document.querySelector('[role=dialog]') &&
        document.hasFocus() &&
        !focused?.matches('input,textarea,[contenteditable=true]')
      ) {
        setReportId(pendingReport.id);
        setPage('reports');
        setPendingReport(null);
      }
    }, 3200);
    return () => clearTimeout(timer);
  }, [pendingReport, form, settingsOpen, guideOpen, focusMode]);
  const bootVersion = useRef(0);
  const navigateRef = useRef<(id?: string) => void>(() => {});
  const newShortcutRef = useRef<(shift: boolean) => void>(() => {});
  const bootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setLanguage(snapshot?.settings.language ?? 'en');
  }, [snapshot?.settings.language]);
  useEffect(() => {
    if (snapshot?.showOnboarding) setGuideOpen(true);
  }, [snapshot?.showOnboarding]);
  useEffect(() => {
    const id =
      page === 'vault'
        ? vaultId
        : page === 'chat'
          ? conversationId
          : page === 'notebooks'
            ? (focusId ?? notebookId)
            : page === 'tasks'
              ? (cardId ?? boardId)
              : page === 'projects'
                ? projectId
                : page === 'matrix'
                  ? matrixFocus
                  : null;
    if (id) void api.workspace({ action: 'visit', id }).catch(() => {});
  }, [page, vaultId, focusId, cardId, boardId, notebookId, conversationId, projectId, matrixFocus]);
  const boot = useCallback(async () => {
    if (bootTimer.current) clearTimeout(bootTimer.current);
    bootTimer.current = null;
    const version = ++bootVersion.current;
    try {
      const next = await api.bootstrap();
      if (version === bootVersion.current) setSnapshot(next);
    } catch (e) {
      if (version === bootVersion.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void boot();
    const unsubscribe = api.onEvent((e) => {
      if (e.type === 'report-ready') setPendingReport(e);
      if (e.type === 'navigate') navigateRef.current((e as any).id);
      if (e.type === 'changed') {
        if (bootTimer.current) clearTimeout(bootTimer.current);
        bootTimer.current = setTimeout(() => void boot(), 40);
      }
      if (e.type === 'memory') setSnapshot((s) => (s ? { ...s, memoryStatus: e.status } : s));
      if (e.type === 'consolidation')
        setSnapshot((s) => (s ? { ...s, consolidationStatus: e.status } : s));
      if (e.type === 'notice') {
        if (e.error) setError(e.error);
        else if (e.summary) setSaveNotice(e.summary);
      }
    });
    return () => {
      unsubscribe();
      if (bootTimer.current) clearTimeout(bootTimer.current);
      bootVersion.current++;
    };
  }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newShortcutRef.current(e.shiftKey);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setForm(null);
        setSearchOpen(false);
        setAccessOpen(false);
        setSettingsOpen(null);
        setTrashOpen(false);
        setCardId(null);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    document.documentElement.dataset.theme = snapshot.settings.theme;
    document.documentElement.dataset.layout = 'studio';
    document.documentElement.dataset.chatWidth = snapshot.settings.chatWidth ?? 'comfortable';
    const color = snapshot.settings.accent;
    if (color !== '#a9c4b4' && /^#[0-9a-f]{6}$/i.test(color)) {
      document.documentElement.style.setProperty('--custom-accent', color);
      const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
      const luminance = rgb.reduce(
        (s, v, i) =>
          s +
          [0.2126, 0.7152, 0.0722][i] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
        0,
      );
      document.documentElement.style.setProperty(
        '--custom-accent-ink',
        luminance > 0.18 ? '#111914' : '#ffffff',
      );
    } else {
      document.documentElement.style.removeProperty('--custom-accent');
      document.documentElement.style.removeProperty('--custom-accent-ink');
    }
  }, [
    snapshot?.settings.theme,
    snapshot?.settings.accent,
    snapshot?.settings.layout,
    snapshot?.settings.chatWidth,
  ]);
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(
      () =>
        void api
          .search(search)
          .then((results) => {
            if (!cancelled) setSearchResults(results);
          })
          .catch((e) => {
            if (!cancelled) setError(e.message);
          }),
      180,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 10000);
      return () => clearTimeout(timer);
    }
  }, [error]);
  useEffect(() => {
    if (!form && !settingsOpen && !accessOpen && !searchOpen && !trashOpen && !guideOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      const dialog =
        document.querySelector<HTMLElement>('.onboarding[role="dialog"]') ??
        dialogs[dialogs.length - 1];
      if (!dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]',
        ),
      ).filter((e) => e.offsetParent !== null);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (!first) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      }
      if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [!!form, settingsOpen !== null, accessOpen, searchOpen, trashOpen, guideOpen]);
  if (!snapshot)
    return (
      <div className="loading-screen">
        <img src="./assets/intelligence-mark.png" alt="" />
        <p>{t('Making a little room for possibility…')}</p>
        {error ? <p>{t(error)}</p> : null}
      </div>
    );
  const activeProfile = snapshot.entities.find(
    (e) => e.id === snapshot.settings.activeAgent && e.kind === 'agent-profile',
  );
  const settings = {
      ...snapshot.settings,
      ...(activeProfile
        ? {
            agentName: activeProfile.title,
            avatar: activeProfile.data.avatar ?? '',
            personality: activeProfile.data.personality ?? snapshot.settings.personality,
          }
        : {}),
    },
    entities = snapshot.entities.filter((e) => !e.deleted),
    find = (id: string | null) => entities.find((e) => e.id === id) ?? null;
  const memories = entities.filter((e) => e.kind === 'memory');
  const displayedMemories = memoryResults
    ? memoryResults.map((m) => find(m.id)).filter((m): m is Entity => m?.kind === 'memory')
    : memories;
  const memoryFailurePrefix = 'Keyword search ready · CPU model unavailable; retries on later use.';
  const memoryFailure = snapshot.memoryStatus?.startsWith(memoryFailurePrefix)
    ? snapshot.memoryStatus.slice(memoryFailurePrefix.length).trim()
    : null;
  const deviceName = system?.displayName ?? snapshot.machine?.displayName ?? t('This device');
  const labels = { ...names, system: deviceName };
  const machineProfile = entities.find((e) => e.kind === 'machine') ?? null;
  const notebooks = entities.filter((e) => e.kind === 'notebook'),
    projects = entities.filter((e) => e.kind === 'project'),
    boards = entities.filter((e) => e.kind === 'board'),
    conversations = entities.filter((e) => e.kind === 'conversation');
  const notebook = find(notebookId),
    focus = find(focusId),
    board = find(boardId) ?? boards[0] ?? null,
    card = find(cardId),
    project = find(projectId),
    conversation = find(conversationId);
  const chatSettings = (chat: Entity | null): Settings => {
    const p = find(chat?.data.agentProfile ?? settings.activeAgent);
    if (p?.kind !== 'agent-profile') return settings;
    const provider =
      chat?.data.branchProvider ??
      (p.data.inheritModel ? settings.provider : (p.data.provider ?? settings.provider));
    return {
      ...settings,
      ...(provider === settings.provider ? {} : settings.providerProfiles?.[provider]),
      provider,
      providerProfiles: {
        ...settings.providerProfiles,
        [settings.provider]: {
          endpoint: settings.endpoint,
          model: settings.model,
          visionEnabled: settings.visionEnabled,
        },
      },
      model:
        chat?.data.branchModel || (p.data.inheritModel ? settings.model : (p.data.model ?? '')),
      agentName: p.title,
      avatar: p.data.avatar ?? '',
      personality: p.data.personality ?? settings.personality,
    };
  };
  const children = (id: string) =>
    entities
      .filter((e) => e.parent === id)
      .sort(
        (a, b) => (a.data.order ?? Date.parse(a.created)) - (b.data.order ?? Date.parse(b.created)),
      );
  const descend = (id: string): Entity[] => children(id).flatMap((e) => [e, ...descend(e.id)]);
  const chapters = notebook ? children(notebook.id).filter((e) => e.kind === 'chapter') : [];
  const activeChapter =
    focus?.kind === 'chapter'
      ? focus
      : focus?.parent
        ? find(focus.parent)?.kind === 'chapter'
          ? find(focus.parent)
          : null
        : null;
  const sectionFocus =
    page === 'tasks'
      ? (card ?? board)
      : page === 'notebooks'
        ? (focus ?? notebook)
        : page === 'vault'
          ? find(vaultId)
          : page === 'projects'
            ? project
            : page === 'calendar'
              ? find(calendarFocus)
              : page === 'reports'
                ? find(assistantReport)
                : page === 'matrix'
                  ? find(matrixFocus)
                  : page === 'agent'
                    ? (activeProfile ?? null)
                    : null;
  const contextRoot =
    scope === 'container'
      ? page === 'tasks'
        ? board
        : notebook
      : scope === 'chapter'
        ? (activeChapter ?? notebook)
        : scope === 'all'
          ? null
          : sectionFocus;
  const context =
    contextRoot && allowed(contextRoot, entities, settings)
      ? ([
          contextRoot,
          ...(contextRoot.data.links ?? [])
            .map((id: string) => find(id))
            .filter((e: Entity | null) => e && allowed(e, entities, settings)),
        ] as Entity[])
      : [];
  const contextChat = find(assistantConversation);
  const assistantSettings = chatSettings(contextChat);
  const screenFocus = {
    section: page,
    mode: scope === 'all' ? 'all' : 'screen',
    entities: context.map((e) => e.id),
  };
  const fail = (e: any) => setError(e instanceof Error ? e.message : String(e));
  const selectItem = (e: Entity, visible: Entity[], event: React.MouseEvent) => {
    const surface = event.currentTarget.closest('[data-selection-surface]');
    if (surface) {
      const ids = [...surface.querySelectorAll<HTMLElement>('[data-selection-id]')]
        .filter((v) => v.getClientRects().length)
        .map((v) => v.dataset.selectionId);
      visible = ids.map((id) => entities.find((v) => v.id === id)).filter((v): v is Entity => !!v);
    }
    if ((event.target as HTMLElement).closest('input,select,textarea,.dropdown,.trash-shortcut'))
      return;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      selectionAnchor.current = e.id;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSelectedIds((old) => {
      const next = new Set(old);
      if (event.shiftKey) {
        const a = visible.findIndex((v) => v.id === selectionAnchor.current),
          b = visible.findIndex((v) => v.id === e.id);
        if (a >= 0 && b >= 0)
          visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((v) => next.add(v.id));
        else {
          next.add(e.id);
          selectionAnchor.current = e.id;
        }
      } else {
        next.has(e.id) ? next.delete(e.id) : next.add(e.id);
        selectionAnchor.current = e.id;
      }
      return next;
    });
  };
  const mutate = async (input: any) => {
    const e = await api.mutate(input);
    await boot();
    return e;
  };
  const patch = async (e: Entity, data: any) => {
    try {
      return await mutate({ id: e.id, data });
    } catch (error) {
      fail(error);
    }
  };
  const changeSettings = async (s: Partial<Settings>) => {
    const previous = snapshot.settings;
    setSnapshot((old) => (old ? { ...old, settings: { ...old.settings, ...s } } : old));
    try {
      await api.settings(s);
      await boot();
      return true;
    } catch (e) {
      setSnapshot((old) =>
        old
          ? {
              ...old,
              settings: {
                ...old.settings,
                ...Object.fromEntries(
                  Object.keys(s).map((key) => [key, previous[key as keyof Settings]]),
                ),
              },
            }
          : old,
      );
      fail(e);
      return false;
    }
  };
  const openEntity = (e: Entity) => {
    void api.workspace({ action: 'visit', id: e.id }).catch(() => {});
    setSearchOpen(false);
    if (e.kind === 'report') {
      setReportId(e.id);
      setPage('reports');
      return;
    }
    if (e.kind === 'report-template') {
      setTemplateFocus(e.id);
      setPage('reports');
      return;
    }
    if (e.kind === 'calendar' || e.kind === 'calendar-event') {
      setCalendarFocus(e.kind === 'calendar-event' ? e.id : null);
      setPage('calendar');
      return;
    }
    if (e.kind.startsWith('vault-')) {
      setVaultId(e.id);
      setPage('vault');
      return;
    }
    if (e.kind.startsWith('matrix-')) {
      setMatrixFocus(e.kind === 'matrix-task' ? e.id : e.parent);
      setPage('matrix');
      return;
    }
    if (e.kind === 'notebook') {
      setPage('notebooks');
      setNotebookId(e.id);
      setFocusId(null);
    } else if (e.kind === 'note' || e.kind === 'chapter') {
      let p = e;
      while (p.parent) {
        const parent = find(p.parent);
        if (!parent) break;
        p = parent;
      }
      setNotebookId(p.id);
      setFocusId(e.id);
      setPage('notebooks');
    } else if (['board', 'list', 'card'].includes(e.kind)) {
      let p = e;
      while (p.parent) {
        const parent = find(p.parent);
        if (!parent) break;
        p = parent;
      }
      setBoardId(p.id);
      setPage('tasks');
      setCardId(e.kind === 'card' ? e.id : null);
    } else if (e.kind === 'conversation') {
      setPage('chat');
      setConversationId(e.id);
    } else if (e.kind === 'memory') setPage('memory');
    else if (e.kind === 'project') {
      setProjectId(e.id);
      setPage('projects');
    } else if (e.kind === 'skill') {
      setPage('skills');
      setEditingSkill(e.id);
    }
  };
  navigateRef.current = (id) => {
    const item = id ? find(id) : null;
    if (item) openEntity(item);
    else setActivityOpen(true);
  };
  const createConversation = async (ids: string[], contextual = false) => {
    const e = await mutate({
      kind: 'conversation',
      title: ids.length
        ? (find(ids[0])?.title ?? t('A new conversation'))
        : t('A new conversation'),
      project: contextual ? null : projectId,
      data: { context: ids },
    });
    if (contextual) setAssistantConversation(e.id);
    else setConversationId(e.id);
    return e;
  };
  function newEntity(kind: Entity['kind'], parent?: string) {
    const notebookKind = kind === 'notebook';
    setForm({
      title: notebookKind
        ? t('A new notebook')
        : kind === 'chapter'
          ? t('A new chapter')
          : kind === 'note'
            ? t('A new note')
            : kind === 'board'
              ? t('A new board')
              : kind === 'list'
                ? t('A new list')
                : t('A new task'),
      subtitle: t('A little space for what comes next.'),
      values: { title: '', description: '' },
      fields: [
        { key: 'title', label: t('Name') },
        {
          key: 'description',
          label: kind === 'card' ? t('Instructions') : t('Description'),
          type: 'textarea',
        },
      ],
      button: t('Create ') + kind,
      submit: async (v) => {
        const e = await mutate({
          kind,
          parent: parent ?? null,
          project: projectId,
          title: v.title,
          data: {
            icon: kind === 'notebook' ? '✳' : undefined,
            cover: kind === 'notebook' ? 'day' : undefined,
            content: kind === 'note' ? '' : kind === 'card' ? v.description : undefined,
            description: kind === 'card' ? undefined : v.description,
            status: kind === 'card' ? 'queued' : undefined,
            access: ['notebook', 'board'].includes(kind) ? false : undefined,
          },
        });
        if (kind === 'notebook') {
          setNotebookId(e.id);
          setFocusId(null);
        }
        if (kind === 'note' || kind === 'chapter') setFocusId(e.id);
        if (kind === 'board') {
          setBoardId(e.id);
          for (const name of [t('To do'), t('In progress'), t('Done')])
            await mutate({ kind: 'list', parent: e.id, title: name, data: {} });
        }
        if (kind === 'card') setCardId(e.id);
        setForm(null);
      },
    });
  }
  const customize = (e: Entity) =>
    setForm({
      title: t('Make it yours'),
      subtitle: e.title,
      values: {
        title: e.title,
        description: e.data.description ?? '',
        icon: e.data.icon ?? '✳',
        cover: e.data.cover ?? 'day',
      },
      fields: [
        { key: 'title', label: t('Name') },
        { key: 'description', label: t('Description'), type: 'textarea' },
        { key: 'icon', label: t('Icon'), type: 'icon' },
        {
          key: 'cover',
          label: t('Artwork'),
          type: 'cover',
          options: [
            { value: 'day', label: t('Ink & ivory') },
            { value: 'night', label: t('After hours') },
            ...(e.data.cover?.startsWith('intelligence-media:') || e.data.cover?.startsWith('data:')
              ? [{ value: e.data.cover, label: t('Current image') }]
              : []),
            { value: 'custom', label: t('Upload an image…') },
          ],
        },
      ],
      button: t('Save changes'),
      submit: async (v) => {
        let cover = v.cover;
        if (cover === 'custom') cover = (await api.image()) ?? e.data.cover;
        await mutate({
          id: e.id,
          title: v.title,
          data: { description: v.description, icon: v.icon, cover },
        });
        setForm(null);
      },
    });
  const rename = (e: Entity) =>
    setForm({
      title: t('Rename ') + e.kind,
      values: { title: e.title },
      fields: [{ key: 'title', label: t('Name') }],
      submit: async (v) => {
        await mutate({ id: e.id, title: v.title });
        setForm(null);
      },
    });
  const trashEntity = async (e: Entity) => {
    try {
      await mutate({ id: e.id, action: 'trash' });
      if (focusId === e.id) setFocusId(null);
      if (notebookId === e.id) setNotebookId(null);
      if (cardId === e.id) setCardId(null);
      setSaveNotice(t('Moved to Trash · Restore from Settings'));
      setTimeout(() => setSaveNotice(''), 5000);
    } catch (err) {
      fail(err);
    }
  };
  const addLink = (e: Entity) =>
    setForm({
      title: t('Connect your work'),
      subtitle: t('Link an item without making a copy.'),
      values: { target: '' },
      fields: [
        {
          key: 'target',
          label: t('Link to'),
          type: 'select',
          options: [
            { value: '', label: t('Choose an item…') },
            ...entities
              .filter(
                (x) =>
                  ['note', 'notebook', 'chapter', 'board', 'card'].includes(x.kind) &&
                  x.id !== e.id,
              )
              .map((x) => ({ value: x.id, label: x.title + ' · ' + x.kind })),
          ],
        },
      ],
      submit: async (v) => {
        if (!v.target) throw new Error(t('Choose an item to link'));
        await patch(e, { links: [...new Set([...(e.data.links ?? []), v.target])] });
        setForm(null);
      },
    });
  const moveEntity = (e: Entity) =>
    setForm({
      title: t('Move ') + e.kind,
      values: { parent: e.parent ?? '' },
      fields: [
        {
          key: 'parent',
          label: t('Move to'),
          type: 'select',
          options: entities
            .filter((x) =>
              e.kind === 'note'
                ? ['notebook', 'chapter'].includes(x.kind)
                : e.kind === 'chapter'
                  ? x.kind === 'notebook'
                  : x.kind === 'list',
            )
            .map((x) => ({ value: x.id, label: x.title })),
        },
      ],
      submit: async (v) => {
        await mutate({ id: e.id, parent: v.parent });
        setForm(null);
      },
    });
  const newProject = () =>
    setForm({
      title: t('Room for a new project'),
      values: { title: '', directory: '', mode: 'create' },
      fields: [
        { key: 'title', label: t('Project name') },
        {
          key: 'mode',
          label: t('Directory'),
          type: 'select',
          options: [
            { value: 'create', label: t('Create a project folder') },
            { value: 'existing', label: t('Choose an existing folder') },
          ],
        },
      ],
      submit: async (v) => {
        const directory = v.mode === 'existing' ? await api.directory() : null;
        if (v.mode === 'existing' && !directory) return;
        const e = await api.project({ title: v.title, directory, create: v.mode === 'create' });
        setProjectId(e.id);
        await boot();
        setForm(null);
      },
    });
  const menu = (e: Entity) => (
    <Menu>
      {selectedIds.has(e.id) && selectedIds.size > 1 ? (
        <>
          <button
            onClick={() => document.querySelector<HTMLSelectElement>('.bulk-bar select')?.focus()}
          >
            {t('Move selected items')}
          </button>
          <button
            onClick={() =>
              [...document.querySelectorAll<HTMLButtonElement>('.bulk-bar button')]
                .find((button) => button.textContent === t('Export'))
                ?.click()
            }
          >
            {t('Export selected items')}
          </button>
          <button
            className="danger"
            onClick={() =>
              void api
                .workspace({
                  action: 'bulk',
                  operation: 'trash',
                  items: entities
                    .filter((v) => selectedIds.has(v.id))
                    .map((v) => ({ id: v.id, revision: v.revision })),
                })
                .then(() => {
                  setSelectedIds(new Set());
                  void boot();
                })
                .catch(fail)
            }
          >
            {t('Move selected items to Trash')}
          </button>
        </>
      ) : null}
      <button
        onClick={() =>
          void api
            .workspace({
              action: 'pin',
              id: e.id,
              enabled: !(settings.pinnedItems ?? []).includes(e.id),
            })
            .then(boot)
            .catch(fail)
        }
      >
        {t((settings.pinnedItems ?? []).includes(e.id) ? 'Unpin' : 'Pin')}
      </button>
      <button onClick={() => rename(e)}>{t('Rename')}</button>
      {e.kind === 'list' && e.parent
        ? [-1, 1].map((direction) => {
            const lists = children(e.parent!),
              at = lists.findIndex((list) => list.id === e.id);
            const before = direction < 0 ? lists[at - 1] : lists[at + 2];
            return (
              <button
                key={direction}
                disabled={direction < 0 ? at === 0 : at === lists.length - 1}
                onClick={() =>
                  void mutate({
                    action: 'reorder',
                    id: e.id,
                    revision: e.revision,
                    beforeId: before?.id ?? null,
                    beforeRevision: before?.revision,
                  }).catch(fail)
                }
              >
                {t(direction < 0 ? 'Move list left' : 'Move list right')}
              </button>
            );
          })
        : null}
      {e.kind === 'project' ? (
        <button
          onClick={() =>
            void api
              .directory()
              .then((directory) =>
                directory ? mutate({ id: e.id, revision: e.revision, data: { directory } }) : null,
              )
              .catch(fail)
          }
        >
          {t('Relink project folder')}
        </button>
      ) : null}
      {(settings.pinnedItems ?? []).includes(e.id) ? (
        <>
          <button
            onClick={() =>
              void api
                .workspace({ action: 'pin-order', id: e.id, direction: -1 })
                .then(boot)
                .catch(fail)
            }
          >
            {t('Move pin up')}
          </button>
          <button
            onClick={() =>
              void api
                .workspace({ action: 'pin-order', id: e.id, direction: 1 })
                .then(boot)
                .catch(fail)
            }
          >
            {t('Move pin down')}
          </button>
        </>
      ) : null}
      {['notebook', 'chapter'].includes(e.kind) ? (
        <button onClick={() => customize(e)}>{t('Customize')}</button>
      ) : null}
      <button onClick={() => addLink(e)}>{t('Link an item')}</button>
      {['note', 'chapter', 'card'].includes(e.kind) ? (
        <button onClick={() => moveEntity(e)}>{t('Move to…')}</button>
      ) : null}
      {e.kind === 'notebook' ? (
        <button
          onClick={() =>
            void api
              .export(e.id)
              .then((p) => p && setSaveNotice(t('Exported to ') + p))
              .catch(fail)
          }
        >
          {t('Export Markdown')}
        </button>
      ) : null}
      <button className="danger" onClick={() => void trashEntity(e)}>
        {t('Move to Trash')}
      </button>
    </Menu>
  );
  const selectedRoot = page === 'tasks' ? board : notebook;
  const linkedWork = (e: Entity) => (
    <section className="linked-items">
      <div>
        <span className="eyebrow">{t('CONNECTED WORK')}</span>
        <button className="quiet-button" onClick={() => addLink(e)}>
          {t('＋ Link something')}
        </button>
      </div>
      {(e.data.links ?? [])
        .map((id: string) => find(id))
        .filter(Boolean)
        .map((linked: Entity) => (
          <button key={linked.id} onClick={() => openEntity(linked)}>
            ✳ {linked.title}
            <span>↗</span>
          </button>
        ))}
      {entities
        .filter((other) => other.data.links?.includes(e.id))
        .map((other) => (
          <button key={other.id} onClick={() => openEntity(other)}>
            {t('↙ Linked from')} {other.title}
          </button>
        ))}
    </section>
  );
  newShortcutRef.current = (shift) => {
    if (settingsOpen || form || guideOpen) return;
    if (page === 'notebooks')
      newEntity(notebook ? (shift ? 'chapter' : 'note') : 'notebook', notebook?.id);
    else if (page === 'tasks')
      newEntity(
        board && children(board.id)[0] ? 'card' : 'board',
        board && children(board.id)[0]?.id,
      );
    else if (page === 'projects') newProject();
    else if (page === 'chat') setConversationId(null);
    else if (page === 'vault')
      [...document.querySelectorAll<HTMLButtonElement>('.vault-create button')]
        .find((button) => button.textContent === t('＋ File'))
        ?.click();
    else if (page === 'skills')
      document.querySelector<HTMLButtonElement>('.skills-page button.primary')?.click();
  };
  const paletteCommands = [
    { id: 'new-notebook', label: t('New notebook'), run: () => newEntity('notebook') },
    ...(notebook
      ? [
          {
            id: 'new-note',
            label: t('New note'),
            run: () => newEntity('note', activeChapter?.id ?? notebook.id),
          },
          {
            id: 'new-chapter',
            label: t('New chapter'),
            run: () => newEntity('chapter', notebook.id),
          },
        ]
      : []),
    ...(board && children(board.id)[0]
      ? [
          {
            id: 'new-card',
            label: t('Add a card'),
            run: () => newEntity('card', children(board.id)[0].id),
          },
        ]
      : []),
    { id: 'new-board', label: t('New board'), run: () => newEntity('board') },
    { id: 'settings', label: t('Open Settings'), run: () => setSettingsOpen('models') },
    {
      id: 'pause',
      label: t(settings.backgroundPaused ? 'Resume background AI' : 'Pause background AI'),
      run: () =>
        void api
          .workspace({ action: 'pause', paused: !settings.backgroundPaused })
          .then(boot)
          .catch(fail),
    },
    { id: 'guide', label: t('Getting started'), run: () => setGuideOpen(true) },
    ...Object.entries(labels).map(([id, label]) => ({
      id: 'go-' + id,
      label: t('Go to') + ' ' + t(label),
      run: () => setPage(id as Page),
    })),
    ...themes.map((theme) => ({
      id: 'theme-' + theme.id,
      label: t('Theme') + ' · ' + t(theme.label),
      run: () => void changeSettings({ theme: theme.id }),
    })),
  ]
    .filter(
      (command) =>
        !search.trim() ||
        (command.label + ' ' + command.id).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .slice(0, 18);
  const contentHeader = (
    eyebrow: string,
    title: string,
    description?: string,
    actions?: React.ReactNode,
  ) => (
    <header className="page-heading overview-heading">
      {!focusMode && !(page === 'tasks' && card) ? (
        <ThemeArt category={sectionArtwork[page]} className="overview-art" variant="banner" />
      ) : null}
      <div className="overview-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="heading-actions">{actions}</div>
    </header>
  );
  const assistantPanel = assistant ? (
    <aside
      className="assistant-pane"
      style={
        { '--pane-width': (settings.paneWidths?.assistant ?? 390) + 'px' } as React.CSSProperties
      }
    >
      <Splitter
        name="Resize assistant"
        value={settings.paneWidths?.assistant ?? 390}
        min={280}
        reverse
        onSave={(v) =>
          void changeSettings({ paneWidths: { ...settings.paneWidths, assistant: v } })
        }
      />
      <div className="assistant-header">
        <div>
          <img src={assistantSettings.avatar || logoPath(settings.logoIcon)} alt="" />
          <span>
            {assistantSettings.agentName}
            <small>{t('Your thought partner')}</small>
          </span>
        </div>
        <button
          className="icon-button assistant-close"
          aria-label={t('Close assistant')}
          onClick={() => setAssistant(false)}
        >
          ×
        </button>
        <button
          className="icon-button assistant-new"
          aria-label={t('New assistant chat')}
          title={t('New assistant chat')}
          disabled={snapshot.activeConversations?.includes(contextChat?.id ?? '')}
          onClick={() => setAssistantConversation(null)}
        >
          <span className="add-symbol" aria-hidden="true" />
        </button>
      </div>
      <div className="scope-control">
        <span>{t('IN THE PICTURE')}</span>
        <select
          aria-label={t('Assistant context scope')}
          value={scope}
          data-tooltip={t(
            'Prioritize the current screen while keeping access to all permitted work. Focus does not change permissions.',
          )}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="current">{t('Current screen')}</option>
          {activeChapter && page === 'notebooks' && sectionFocus?.id !== activeChapter.id ? (
            <option value="chapter">{t('Entire chapter')}</option>
          ) : null}
          {((page === 'tasks' && card) ||
            (page === 'notebooks' && notebook && sectionFocus?.id !== notebook.id)) && (
            <option value="container">
              {page === 'tasks' ? t('Entire board') : t('Entire notebook')}
            </option>
          )}
          <option value="all">{t('All accessible work')}</option>
        </select>
        <div className="assistant-focus-summary">
          {scope === 'all' ? t('All accessible work') : contextRoot?.title || t(labels[page])}
        </div>
        {contextRoot && !context.length ? (
          <button
            className="scope-warning"
            onClick={() =>
              page === 'tasks' || page === 'notebooks'
                ? setAccessOpen(true)
                : setSettingsOpen('access')
            }
          >
            {t('Agent access is off · Choose access ↗')}
          </button>
        ) : null}
      </div>
      <Chat
        settings={assistantSettings}
        conversation={contextChat}
        running={snapshot.activeConversations?.includes(contextChat?.id ?? '')}
        pendingApprovals={snapshot.approvals}
        context={context}
        screenFocus={screenFocus}
        onNew={(ids) => createConversation(ids, true)}
        onSettings={() => setSettingsOpen('models')}
        compact
        onBranched={(e) => {
          setAssistantConversation(e.id);
          void boot();
        }}
        onError={setError}
      />
    </aside>
  ) : null;

  return (
    <div
      className={'app-shell ' + (focusMode ? 'focus-mode' : '')}
      data-backgrounds={settings.decorativeBackgrounds !== false}
      data-notebook-look={settings.notebookLook ?? 'bound'}
    >
      {marquee}
      <AppBackground settings={settings} />
      <header className="titlebar">
        <span>Intelligence · {releaseLabel(version)}</span>
        <div className="window-actions">
          <button aria-label={t('Minimize window')} onClick={() => void api.window('minimize')}>
            −
          </button>
          <button aria-label={t('Maximize window')} onClick={() => void api.window('maximize')}>
            □
          </button>
          <button aria-label={t('Close window')} onClick={() => void api.window('close')}>
            ×
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside
          className="sidebar"
          style={
            { '--pane-width': (settings.paneWidths?.sidebar ?? 238) + 'px' } as React.CSSProperties
          }
        >
          <Splitter
            name="Resize sidebar"
            value={settings.paneWidths?.sidebar ?? 238}
            max={360}
            onSave={(v) =>
              void changeSettings({ paneWidths: { ...settings.paneWidths, sidebar: v } })
            }
          />
          <button
            className="agent-profile agent-profile-top"
            onClick={() => setPage('agent')}
            title={t('Open your agent and manage profiles')}
          >
            <img
              src={settings.avatar || logoPath(settings.logoIcon)}
              alt=""
              style={{ filter: settings.logoIcon !== 'original' ? 'none' : undefined }}
            />
            <span>
              {settings.agentName}
              <small>{settings.model ? t('Model selected') : t('Ready when you are')}</small>
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
          <button className="search-button" onClick={() => setSearchOpen(true)}>
            <span>⌕</span>
            {t('Find anything')}
            <kbd>Ctrl K</kbd>
          </button>
          <div className="sidebar-scroll">
            <nav aria-label={t('Main navigation')}>
              <span className="nav-heading">{t('YOUR SPACE')}</span>
              {(
                [
                  'chat',
                  'projects',
                  'notebooks',
                  'vault',
                  'tasks',
                  'calendar',
                  'reports',
                  'matrix',
                ] as Page[]
              ).map((p) => (
                <div className="nav-with-history" key={p}>
                  <button
                    key={p}
                    aria-label={t(labels[p])}
                    className={'nav-item ' + (page === p ? 'selected' : '')}
                    onPointerEnter={() => {
                      if (p === 'notebooks' || p === 'vault') void preloadEditor();
                    }}
                    onFocus={() => {
                      if (p === 'notebooks' || p === 'vault') void preloadEditor();
                    }}
                    onClick={() => {
                      if (p === 'notebooks' || p === 'vault') void preloadEditor();
                      setPage(p);
                      setFocusMode(false);
                    }}
                  >
                    <Icon name={navIcon[p]} className="nav-glyph" />
                    {t(labels[p])}
                    {p === 'notebooks' ? <small>{notebooks.length}</small> : null}
                    {p === 'tasks' &&
                    entities.some((e) => e.kind === 'card' && e.data.status === 'running') ? (
                      <i className="running-dot" />
                    ) : null}
                  </button>
                  {p === 'chat' && (
                    <button
                      className="conversation-history-trigger"
                      aria-label={t('Recent conversations')}
                      title={t('Open recent conversations')}
                      onClick={() => setConversationsOpen(true)}
                    >
                      ◷
                    </button>
                  )}
                </div>
              ))}
              <span className="nav-heading spaced">{t('YOUR COMPANION')}</span>
              {(['system', 'memory', 'skills', 'connections'] as Page[]).map((p) => (
                <button
                  key={p}
                  aria-label={t(labels[p])}
                  className={'nav-item ' + (page === p ? 'selected' : '')}
                  onPointerEnter={() => {
                    if (p === 'notebooks' || p === 'vault') void preloadEditor();
                  }}
                  onFocus={() => {
                    if (p === 'notebooks' || p === 'vault') void preloadEditor();
                  }}
                  onClick={() => {
                    if (p === 'notebooks' || p === 'vault') void preloadEditor();
                    setPage(p);
                    if (p === 'system') void api.system().then(setSystem).catch(fail);
                  }}
                >
                  <Icon name={navIcon[p]} className="nav-glyph" />
                  {t(labels[p])}
                </button>
              ))}
            </nav>
            {(settings.pinnedItems ?? []).length ? (
              <div className="sidebar-pins">
                <span className="eyebrow">{t('PINNED')}</span>
                {settings.pinnedItems
                  .map((id) => find(id))
                  .filter(Boolean)
                  .map((e) => (
                    <button key={e!.id} onClick={() => openEntity(e!)}>
                      {e!.title}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-utilities">
              <button
                onClick={() =>
                  void changeSettings({
                    theme: settings.theme === 'night' ? settings.returnTheme || 'day' : 'night',
                    ...(settings.theme !== 'night' ? { returnTheme: settings.theme } : {}),
                  })
                }
                aria-label={t('Switch theme')}
                title={t(settings.theme === 'night' ? 'Restore chosen theme' : 'Switch to Night')}
              >
                {settings.theme === 'night' ? '☼' : '☾'}
              </button>
              <button
                title={t('Settings')}
                aria-label={t('Settings')}
                onClick={() => setSettingsOpen('models')}
              >
                <Icon name="settings" />
              </button>
            </div>
          </div>
        </aside>
        <main className="workspace">
          <div className="workspace-top">
            <button
              className="background-pause"
              aria-label={t(settings.backgroundPaused ? 'Resume background AI' : 'Pause background AI')}
              aria-pressed={settings.backgroundPaused}
              data-paused={settings.backgroundPaused}
              data-tooltip={t(settings.backgroundPaused ? 'Resume automatic tasks and memory processing.' : 'Pause automatic AI work; foreground chat remains available.')}
              title={t(settings.backgroundPaused ? 'Resume background AI' : 'Pause background AI')}
              onClick={() =>
                void api
                  .workspace({ action: 'pause', paused: !settings.backgroundPaused })
                  .then(boot)
                  .catch(fail)
              }
            >
              <Icon name={settings.backgroundPaused ? 'play' : 'pause'} />
              <span>{t(settings.backgroundPaused ? 'Resume AI' : 'Pause AI')}</span>
            </button>
            <div className="breadcrumbs">
              <span>{glyph[page]}</span>
              <button
                onClick={() => {
                  if (page === 'notebooks') {
                    setNotebookId(null);
                    setFocusId(null);
                  } else if (page === 'tasks') setCardId(null);
                }}
              >
                {t(labels[page])}
              </button>
              {notebook && page === 'notebooks' ? (
                <>
                  <span>›</span>
                  <button onClick={() => setFocusId(null)}>{notebook.title}</button>
                </>
              ) : null}
              {focus && page === 'notebooks' ? (
                <>
                  <span>›</span>
                  <span>{focus.title}</span>
                </>
              ) : null}
              {page === 'tasks' && board ? (
                <>
                  <span>›</span>
                  <span>{board.title}</span>
                </>
              ) : null}
            </div>
            <div className="workspace-top-actions">
              <button
                className="global-activity"
                aria-label={t('Activity')}
                title={t('Activity')}
                aria-expanded={activityOpen}
                onClick={() => setActivityOpen(!activityOpen)}
              >
                <Icon name="activity" />
                {pendingReport && <i className="activity-badge" />}
              </button>
              {page !== 'matrix' ? (
                <select
                  className="project-picker"
                  aria-label={t('Active project')}
                  value={projectId ?? ''}
                  onChange={(e) => setProjectId(e.target.value || null)}
                >
                  <option value="">{t('All projects')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                className="quiet-button"
                onClick={() =>
                  page === 'tasks' || page === 'notebooks'
                    ? setAccessOpen(true)
                    : setSettingsOpen('access')
                }
              >
                {t('◎ Agent access')}
              </button>
              <button
                className={'assistant-toggle ' + (assistant ? 'active' : '')}
                aria-expanded={assistant}
                onClick={() => setAssistant((v) => !v)}
              >
                ✦ {t('Ask ') + assistantSettings.agentName}
              </button>
              <button
                className="icon-button"
                aria-label={t('Focus mode')}
                onClick={() => setFocusMode((v) => !v)}
              >
                {focusMode ? '⊞' : '⤢'}
              </button>
            </div>
          </div>
          <div className="workspace-content">
            <div className="main-canvas">
              <Suspense
                fallback={
                  <div className="page-pad" role="status">
                    {t('Opening section…')}
                  </div>
                }
              >
                {page === 'calendar' && (
                  <Calendar
                    snapshot={snapshot}
                    initialId={calendarFocus}
                    onHandled={() => setCalendarFocus(null)}
                    onSettings={changeSettings}
                    onChanged={boot}
                    onError={fail}
                    onOpen={(id) => {
                      const e = find(id);
                      if (e) openEntity(e);
                    }}
                  />
                )}
                {page === 'reports' && (
                  <Reports
                    snapshot={snapshot}
                    initialId={reportId}
                    initialTemplate={templateFocus}
                    onTemplateHandled={() => setTemplateFocus(null)}
                    onHandled={() => setReportId(null)}
                    onChanged={boot}
                    onSettings={changeSettings}
                    onError={fail}
                    onOpen={(id) => {
                      const e = find(id);
                      if (e) openEntity(e);
                    }}
                    onAsk={(e) => {
                      setAssistantReport(e.id);
                      setScope('current');
                      setAssistant(true);
                    }}
                  />
                )}
                {page === 'vault' ? (
                  <Vault
                    initialId={vaultId}
                    onSelect={setVaultId}
                    snapshot={snapshot}
                    onError={fail}
                    onSettings={changeSettings}
                    onAsk={(item) => {
                      setVaultId(item.id);
                      setScope('current');
                      setAssistant(true);
                    }}
                  />
                ) : null}
                {page === 'matrix' ? (
                  <CognitionMatrix
                    snapshot={{ ...snapshot, settings: chatSettings(null) }}
                    initialTask={matrixFocus}
                    onFocus={setMatrixFocus}
                    onError={fail}
                    onSettings={() => setSettingsOpen('matrix')}
                    onConversation={(chat) => {
                      setConversationId(chat.id);
                      setPage('chat');
                    }}
                  />
                ) : null}
                {page === 'chat' ? (
                  <>
                    <div className="chat-top">
                      <span>
                        {conversation?.title ?? t('A fresh conversation')}
                        {conversation?.data.readOnlyMachine ? (
                          <small className="machine-chat-badge">
                            {t('◎ Read-only machine context')}
                          </small>
                        ) : null}
                      </span>
                      <div>
                        {conversation ? menu(conversation) : null}
                        <button className="quiet-button" onClick={() => setConversationId(null)}>
                          {t('＋ New chat')}
                        </button>
                      </div>
                    </div>
                    <Chat
                      settings={chatSettings(conversation)}
                      conversation={conversation}
                      running={snapshot.activeConversations?.includes(conversation?.id ?? '')}
                      pendingApprovals={snapshot.approvals}
                      context={
                        conversation
                          ? (conversation.data.context ?? [])
                              .map((id: string) => find(id))
                              .filter((e: Entity | null) => e && allowed(e, entities, settings))
                          : []
                      }
                      onNew={(ids) => createConversation(ids)}
                      onBranched={(e) => {
                        setConversationId(e.id);
                        void boot();
                      }}
                      onSettings={() =>
                        conversation?.data.matrixTask
                          ? setPage('matrix')
                          : setSettingsOpen('models')
                      }
                      onError={setError}
                    />
                  </>
                ) : null}
                {page === 'notebooks' && !notebook ? (
                  <div className="library page-pad">
                    {contentHeader(
                      t('THINKING SPACE'),
                      t('Your thoughts, collected.'),
                      t('A home for ideas, discoveries, and everything in between.'),
                      <button className="primary" onClick={() => newEntity('notebook')}>
                        {t('＋ New notebook')}
                      </button>,
                    )}
                    <div className="library-toolbar">
                      <span>
                        {notebooks.length} {t(notebooks.length === 1 ? 'notebook' : 'notebooks')}
                      </span>
                      <span>{t('Made for a wandering mind. Organized for yours.')}</span>
                    </div>
                    <div
                      className="notebook-grid notebook-shelf app-collection"
                      data-selection-surface
                    >
                      {notebooks
                        .filter((n) => !projectId || n.project === projectId)
                        .slice(0, pageLimit)
                        .map((n) => (
                          <NotebookCover
                            key={n.id}
                            notebook={n}
                            notes={descend(n.id).filter((e) => e.kind === 'note').length}
                            shared={allowed(n, entities, settings)}
                            menu={menu(n)}
                            onOpen={() => {
                              setNotebookId(n.id);
                              setFocusId(null);
                            }}
                            selected={selectedIds.has(n.id)}
                            onSelect={(event) => selectItem(n, notebooks, event)}
                          />
                        ))}
                      <button className="new-notebook-card" onClick={() => newEntity('notebook')}>
                        <span>＋</span>
                        <b>{t('Something new?')}</b>
                        <small>{t('Give it a notebook.')}</small>
                      </button>
                    </div>
                    <div className="library-bottom">
                      <span>✳</span>
                      <p>
                        {t('Think freely. Keep what matters.')}
                        <br />
                        <small>{t('Your notebooks live on your machine.')}</small>
                      </p>
                    </div>
                  </div>
                ) : null}
                {page === 'notebooks' && notebook ? (
                  <div className="notebook-workspace">
                    <aside
                      className="notebook-nav app-collection"
                      data-selection-surface
                      style={
                        {
                          '--pane-width': (settings.paneWidths?.navigator ?? 265) + 'px',
                        } as React.CSSProperties
                      }
                    >
                      <Splitter
                        name="Resize navigator"
                        value={settings.paneWidths?.navigator ?? 265}
                        min={210}
                        max={450}
                        onSave={(v) =>
                          void changeSettings({
                            paneWidths: { ...settings.paneWidths, navigator: v },
                          })
                        }
                      />
                      <div className="notebook-nav-title">
                        <span>{notebook.data.icon ?? '✳'}</span>
                        <b>{notebook.title}</b>
                        {menu(notebook)}
                      </div>
                      <button
                        className={'notebook-overview ' + (!focus ? 'current' : '')}
                        onClick={() => setFocusId(null)}
                      >
                        {t('Notebook overview')}
                      </button>
                      <div className="notebook-nav-actions">
                        <span>{t('CONTENTS')}</span>
                        <Menu label="Create note or chapter">
                          <button
                            onClick={() => newEntity('note', activeChapter?.id ?? notebook.id)}
                          >
                            {t('New note')}
                          </button>
                          <button onClick={() => newEntity('chapter', notebook.id)}>
                            {t('New chapter')}
                          </button>
                        </Menu>
                      </div>
                      {children(notebook.id)
                        .filter((e) => e.kind === 'note')
                        .map((e) => (
                          <div
                            className="note-nav-row"
                            key={e.id}
                            data-selected={selectedIds.has(e.id)}
                            data-selection-id={e.id}
                            onClickCapture={(event) =>
                              selectItem(
                                e,
                                entities.filter(
                                  (e) =>
                                    e.parent === notebook.id ||
                                    (e.parent && chapters.some((c) => c.id === e.parent)),
                                ),
                                event,
                              )
                            }
                          >
                            <button
                              className={focus?.id === e.id ? 'current' : ''}
                              onClick={() => setFocusId(e.id)}
                            >
                              <span>≡</span>
                              {e.title}
                            </button>
                            {menu(e)}
                          </div>
                        ))}
                      {chapters.map((ch) => (
                        <details
                          className="chapter-tree"
                          open
                          key={ch.id}
                          data-selected={selectedIds.has(ch.id)}
                          data-selection-id={ch.id}
                        >
                          <summary>
                            <button
                              className={focus?.id === ch.id ? 'current' : ''}
                              onClick={(e) => {
                                e.preventDefault();
                                if (e.ctrlKey || e.metaKey || e.shiftKey)
                                  selectItem(
                                    ch,
                                    entities.filter(
                                      (e) =>
                                        e.parent === notebook.id ||
                                        (e.parent && chapters.some((c) => c.id === e.parent)),
                                    ),
                                    e,
                                  );
                                else {
                                  selectionAnchor.current = ch.id;
                                  setFocusId(ch.id);
                                }
                              }}
                            >
                              {ch.data.icon ?? '⌘'} {ch.title}
                            </button>
                            {menu(ch)}
                          </summary>
                          <div>
                            {children(ch.id).map((e) => (
                              <div
                                className="note-nav-row"
                                key={e.id}
                                data-selection-id={e.id}
                                data-selected={selectedIds.has(e.id)}
                                onClickCapture={(event) => selectItem(e, children(ch.id), event)}
                              >
                                <button
                                  className={focus?.id === e.id ? 'current' : ''}
                                  onClick={() => setFocusId(e.id)}
                                >
                                  <span>≡</span>
                                  {e.title}
                                </button>
                                {menu(e)}
                              </div>
                            ))}
                            <button className="add-note" onClick={() => newEntity('note', ch.id)}>
                              {t('＋ Add a note')}
                            </button>
                          </div>
                        </details>
                      ))}
                      <div className="notebook-nav-bottom">
                        <button onClick={() => newEntity('note', activeChapter?.id ?? notebook.id)}>
                          {t('＋ New note')}
                        </button>
                        <button onClick={() => newEntity('chapter', notebook.id)}>
                          {t('⌑ New chapter')}
                        </button>
                      </div>
                    </aside>
                    <section className="note-area">
                      {focus?.kind === 'note' ? (
                        <>
                          <header className="note-heading">
                            <span className="eyebrow">
                              {activeChapter?.title ?? notebook.title}
                            </span>
                            <div>
                              <input
                                aria-label={t('Note title')}
                                key={focus.id + focus.title}
                                defaultValue={focus.title}
                                onBlur={(e) => {
                                  if (e.target.value.trim() && e.target.value !== focus.title)
                                    void mutate({ id: focus.id, title: e.target.value }).catch(
                                      fail,
                                    );
                                }}
                              />
                              {menu(focus)}
                            </div>
                          </header>
                          <NoteEditor
                            key={focus.id}
                            note={focus}
                            onSaved={() => void boot()}
                            onError={setError}
                          />
                          <section className="linked-items">
                            <div>
                              <span className="eyebrow">{t('CONNECTED WORK')}</span>
                              <button className="quiet-button" onClick={() => addLink(focus)}>
                                {t('＋ Link something')}
                              </button>
                            </div>
                            {(focus.data.links ?? [])
                              .map((id: string) => find(id))
                              .filter(Boolean)
                              .map((e: Entity) => (
                                <button key={e.id} onClick={() => openEntity(e)}>
                                  {
                                    glyph[
                                      e.kind === 'card' || e.kind === 'board'
                                        ? 'tasks'
                                        : 'notebooks'
                                    ]
                                  }{' '}
                                  {e.title}
                                  <span>↗</span>
                                </button>
                              ))}
                            {entities
                              .filter((e) => e.data.links?.includes(focus.id))
                              .map((e) => (
                                <button key={e.id} onClick={() => openEntity(e)}>
                                  {t('↙ Linked from')} {e.title}
                                </button>
                              ))}
                          </section>
                        </>
                      ) : (
                        <>
                          <div
                            className="notebook-banner"
                            style={{
                              backgroundColor: coverColor(
                                (focus?.kind === 'chapter' ? focus : notebook).data.cover ??
                                  notebook.data.cover,
                              ),
                            }}
                          >
                            {coverColor(
                              (focus?.kind === 'chapter' ? focus : notebook).data.cover ??
                                notebook.data.cover,
                            ) ? null : (
                              <img
                                src={art(
                                  (focus?.kind === 'chapter' ? focus : notebook).data.cover ??
                                    notebook.data.cover,
                                )}
                                alt=""
                              />
                            )}
                            <button
                              className="cover-edit"
                              onClick={() =>
                                customize(focus?.kind === 'chapter' ? focus : notebook)
                              }
                            >
                              {t('Customize cover ↗')}
                            </button>
                          </div>
                          <div className="notebook-overview-body">
                            <span className="overview-icon">
                              {(focus ?? notebook).data.icon ?? '✳'}
                            </span>
                            <h1>{(focus ?? notebook).title}</h1>
                            <p>
                              {(focus ?? notebook).data.description ||
                                t('A little room for your thoughts.')}
                            </p>
                            <div className="overview-actions">
                              <button
                                className="primary"
                                onClick={() => newEntity('note', focus?.id ?? notebook.id)}
                              >
                                {t('＋ New note')}
                              </button>
                              {!focus ? (
                                <button onClick={() => newEntity('chapter', notebook.id)}>
                                  {t('New chapter')}
                                </button>
                              ) : null}
                              <button onClick={() => setAssistant(true)}>
                                {t('✦ Think together')}
                              </button>
                            </div>
                            {focus?.kind === 'chapter' && focus.data.content?.trim() && (
                              <ChapterContent
                                key={focus.id}
                                chapter={focus}
                                onError={fail}
                                onCreated={(note) => {
                                  void boot();
                                  setFocusId(note.id);
                                }}
                              />
                            )}
                            <div className="overview-notes app-collection" data-selection-surface>
                              {children(focus?.id ?? notebook.id).map((e) => (
                                <button
                                  key={e.id}
                                  data-selection-id={e.id}
                                  data-selected={selectedIds.has(e.id)}
                                  onClickCapture={(event) =>
                                    selectItem(e, children(focus?.id ?? notebook.id), event)
                                  }
                                  onClick={() => setFocusId(e.id)}
                                >
                                  <span>{e.kind === 'chapter' ? (e.data.icon ?? '⌘') : '≡'}</span>
                                  <div>
                                    <b>{e.title}</b>
                                    <small>
                                      {e.kind === 'chapter'
                                        ? children(e.id).length +
                                          ' ' +
                                          t(children(e.id).length === 1 ? 'note' : 'notes')
                                        : (e.data.content ?? '')
                                            .replace(/[#*>`\n]/g, ' ')
                                            .slice(0, 95) ||
                                          t('A blank page, full of possibility.')}
                                    </small>
                                  </div>
                                  <span>↗</span>
                                </button>
                              ))}
                            </div>
                            {linkedWork(focus ?? notebook)}
                          </div>
                        </>
                      )}
                    </section>
                  </div>
                ) : null}
                {page === 'tasks' ? (
                  <div className="tasks-page page-pad">
                    {contentHeader(
                      t('A LITTLE MOMENTUM'),
                      card ? card.title : t('Good intentions. Next steps.'),
                      card
                        ? t('Give this task a clear brief and the right context.')
                        : (board?.data.description ?? t('Make room for the work that matters.')),
                      <>
                        <select
                          aria-label={t('Task board')}
                          value={board?.id ?? ''}
                          onChange={(e) => {
                            setBoardId(e.target.value);
                            setCardId(null);
                          }}
                        >
                          {boards.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.title}
                            </option>
                          ))}
                        </select>
                        {!card && (
                          <button onClick={() => newEntity('board')}>{t('＋ Board')}</button>
                        )}
                        {board ? menu(board) : null}
                      </>,
                    )}
                    {board ? (
                      <>
                        {!card && (
                          <div className="board-controls">
                            <button className="quiet-button" onClick={() => setCardId(null)}>
                              {t('▥ Board')}
                            </button>
                            <label className="assignment-control">
                              <Check
                                checked={board.data.assigned === true}
                                onChange={(e) => void patch(board, { assigned: e.target.checked })}
                              />{' '}
                              {t('Let')} {settings.agentName} {t('work on this board')}
                            </label>
                            <button
                              className="quiet-button"
                              onClick={() => newEntity('list', board.id)}
                            >
                              {t('＋ Add list')}
                            </button>
                          </div>
                        )}
                        {card ? (
                          <TaskDetail
                            key={card.id}
                            card={card}
                            settings={settings}
                            entities={entities}
                            menu={menu(card)}
                            onPatch={(data) => patch(card, data)}
                            onBack={() => setCardId(null)}
                            onAttach={() => addLink(card)}
                            onOpen={openEntity}
                            onError={fail}
                            onConversation={(id) => {
                              setConversationId(id);
                              setPage('chat');
                            }}
                          />
                        ) : (
                          <div
                            className="kanban-board app-collection"
                            data-selection-surface
                            onDragOver={(event) => {
                              if (!dragList) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              const nodes = [
                                ...event.currentTarget.querySelectorAll<HTMLElement>(
                                  '[data-list-id]',
                                ),
                              ].filter((node) => node.dataset.listId !== dragList);
                              const before =
                                nodes.find((node) => {
                                  const rect = node.getBoundingClientRect();
                                  return event.clientX < rect.left + rect.width / 2;
                                })?.dataset.listId ?? null;
                              setListDrop((old) => (old?.before === before ? old : { before }));
                              const rect = event.currentTarget.getBoundingClientRect();
                              if (event.clientX < rect.left + 48)
                                event.currentTarget.scrollLeft -= 20;
                              if (event.clientX > rect.right - 48)
                                event.currentTarget.scrollLeft += 20;
                            }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                                setListDrop(null);
                            }}
                            onDrop={(event) => {
                              if (!dragList) return;
                              event.preventDefault();
                              const source = find(dragList),
                                before = find(listDrop?.before ?? null);
                              if (source?.kind === 'list' && source.parent === board.id && listDrop)
                                void mutate({
                                  action: 'reorder',
                                  id: source.id,
                                  revision: source.revision,
                                  beforeId: before?.id ?? null,
                                  beforeRevision: before?.revision,
                                }).catch(fail);
                              clearListDrag();
                            }}
                          >
                            {children(board.id).map((list) => (
                              <section
                                className={
                                  'kanban-list ' +
                                  (cardDrop?.list === list.id ? 'card-drop-list ' : '') +
                                  (dragList === list.id ? 'list-dragging ' : '') +
                                  (listDrop?.before === list.id ? 'list-drop-before ' : '') +
                                  (listDrop &&
                                  listDrop.before === null &&
                                  children(board.id).at(-1)?.id === list.id
                                    ? 'list-drop-after'
                                    : '')
                                }
                                key={list.id}
                                data-list-id={list.id}
                                onDragOver={(e) => {
                                  if (!dragCard) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'move';
                                  const cards = [
                                    ...e.currentTarget.querySelectorAll<HTMLElement>(
                                      '.task-card-shell',
                                    ),
                                  ].filter((node) => node.dataset.cardId !== dragCard);
                                  const before =
                                    cards.find((node) => {
                                      const rect = node.getBoundingClientRect();
                                      return e.clientY < rect.top + rect.height / 2;
                                    })?.dataset.cardId ?? null;
                                  setCardDrop((old) =>
                                    old?.list === list.id && old.before === before
                                      ? old
                                      : { list: list.id, before },
                                  );
                                }}
                                onDragLeave={(e) => {
                                  if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                                    setCardDrop(null);
                                }}
                                onDrop={(e) => {
                                  if (!dragCard) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const source = find(dragCard),
                                    before = find(cardDrop?.before ?? null);
                                  if (source?.kind === 'card' && cardDrop?.list === list.id)
                                    void mutate({
                                      action: 'reorder',
                                      id: source.id,
                                      revision: source.revision,
                                      parent: list.id,
                                      beforeId: before?.id ?? null,
                                      beforeRevision: before?.revision,
                                    }).catch(fail);
                                  clearCardDrag();
                                }}
                              >
                                <header>
                                  <button
                                    className="list-drag-handle"
                                    draggable
                                    aria-label={t('Drag to reorder list') + ': ' + list.title}
                                    data-tooltip={t(
                                      'Drag to reorder list. Use the list menu to move left or right.',
                                    )}
                                    onDragStart={(event) => {
                                      event.dataTransfer.setData(
                                        'application/x-intelligence-list',
                                        list.id,
                                      );
                                      event.dataTransfer.effectAllowed = 'move';
                                      clearCardDrag();
                                      setDragList(list.id);
                                    }}
                                    onDragEnd={clearListDrag}
                                  >
                                    <Icon name="grip" />
                                  </button>
                                  <span>
                                    <i />
                                    {list.title}
                                    <small>{children(list.id).length}</small>
                                  </span>
                                  {menu(list)}
                                </header>
                                <label className="list-assignment">
                                  <Check
                                    checked={
                                      list.data.assigned === true ||
                                      (list.data.assigned == null && board.data.assigned === true)
                                    }
                                    onChange={(e) =>
                                      void patch(list, { assigned: e.target.checked })
                                    }
                                  />{' '}
                                  {t('Agent tasks')}
                                </label>
                                {children(list.id).map((c) => (
                                  <article
                                    className={
                                      'task-card-shell ' +
                                      (dragCard === c.id ? 'card-dragging ' : '') +
                                      (cardDrop?.list === list.id && cardDrop.before === c.id
                                        ? 'card-drop-before'
                                        : '')
                                    }
                                    data-selected={selectedIds.has(c.id)}
                                    data-selection-id={c.id}
                                    onClickCapture={(event) =>
                                      selectItem(
                                        c,
                                        children(board.id).flatMap((l) => children(l.id)),
                                        event,
                                      )
                                    }
                                    data-card-id={c.id}
                                    key={c.id}
                                  >
                                    <button
                                      draggable
                                      onDragStart={(e) => {
                                        clearListDrag();
                                        e.dataTransfer.setData(
                                          'application/x-intelligence-card',
                                          c.id,
                                        );
                                        e.dataTransfer.effectAllowed = 'move';
                                        setDragCard(c.id);
                                      }}
                                      onDragEnd={clearCardDrag}
                                      className="task-card"
                                      onClick={() => setCardId(c.id)}
                                    >
                                      <span className="task-card-kind">
                                        {c.data.assigned === false
                                          ? t('YOUR TASK')
                                          : c.data.assigned
                                            ? t('AGENT TASK')
                                            : t('NEXT STEP')}
                                      </span>
                                      <b>{c.title}</b>
                                      {c.data.content ? (
                                        <p>{c.data.content.slice(0, 120)}</p>
                                      ) : null}
                                      <footer>
                                        <span>{c.data.status ?? 'queued'}</span>
                                        <span>
                                          {c.data.schedule?.start
                                            ? time(c.data.schedule.start)
                                            : '↗'}
                                        </span>
                                      </footer>
                                    </button>
                                    {menu(c)}
                                  </article>
                                ))}
                                {cardDrop?.list === list.id && cardDrop.before === null ? (
                                  <div className="card-drop-end" role="status">
                                    {t('Drop card here')}
                                  </div>
                                ) : null}
                                <button
                                  className="add-card"
                                  onClick={() => newEntity('card', list.id)}
                                >
                                  {t('＋ Add a card')}
                                </button>
                              </section>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <button className="primary" onClick={() => newEntity('board')}>
                        {t('Create your first board')}
                      </button>
                    )}
                  </div>
                ) : null}
                {page === 'agent' ? (
                  <AgentScreen snapshot={snapshot} onChanged={boot} onError={fail} />
                ) : null}
                {page === 'projects' ? (
                  <div className="page-pad projects-page">
                    {contentHeader(
                      t('ROOM TO CREATE'),
                      t('A place for every possibility.'),
                      'Keep the files, conversations, and context of your work together.',
                      <button className="primary" onClick={newProject}>
                        {t('＋ New project')}
                      </button>,
                    )}
                    <div className="resource-grid app-collection" data-selection-surface>
                      {projects.slice(0, pageLimit).map((p) => (
                        <article
                          className="resource-card"
                          key={p.id}
                          data-selected={selectedIds.has(p.id)}
                          data-selection-id={p.id}
                          onClickCapture={(event) => selectItem(p, projects, event)}
                        >
                          <span className="resource-icon">⌑</span>
                          {menu(p)}
                          <h2>{p.title}</h2>
                          <p className="path-text">{p.data.directory}</p>
                          <div className="project-access">
                            <label>
                              <Check
                                checked={p.data.access === true}
                                onChange={(e) => void patch(p, { access: e.target.checked })}
                              />{' '}
                              {t('Agent access')}
                            </label>
                            <select
                              aria-label={t('Project permissions for ') + p.title}
                              value={p.data.permission ?? 'edit'}
                              onChange={(e) => void patch(p, { permission: e.target.value })}
                            >
                              <option value="read">{t('Read')}</option>
                              <option value="edit">{t('Read & edit')}</option>
                            </select>
                          </div>
                          <button onClick={() => {
                            setProjectId(p.id);
                            setProjectBrowseRequest(value => value + 1);
                          }}>{t('Browse files')}</button>
                          <small>
                            {entities.filter((e) => e.project === p.id).length}{' '}
                            {t('associated items')}
                          </small>
                        </article>
                      ))}
                      {!projects.length ? (
                        <div className="empty-state">
                          <span>⌑</span>
                          <h2>{t('Give your next idea a home.')}</h2>
                          <p>
                            {t('Create a project folder or choose one you already have.')}
                            <br />
                            {t('Intelligence will use it as the starting place for your work.')}
                          </p>
                          <button onClick={newProject}>{t('Create a project ↗')}</button>
                        </div>
                      ) : null}
                    </div>
                    {project ? <ProjectBrowser project={project} focusRequest={projectBrowseRequest} onError={fail} /> : null}
                  </div>
                ) : null}
                {page === 'memory' ? (
                  <div className="page-pad">
                    {contentHeader(
                      t('WORTH REMEMBERING'),
                      t('The threads that connect.'),
                      t('Useful facts, preferences, and discoveries, kept on your machine.'),
                      <button
                        className="primary"
                        onClick={() =>
                          setForm({
                            title: t('Remember something'),
                            values: { content: '' },
                            fields: [
                              {
                                key: 'content',
                                label: t('What is worth remembering?'),
                                type: 'textarea',
                              },
                            ],
                            submit: async (v) => {
                              await mutate({
                                kind: 'memory',
                                title: v.content.slice(0, 70),
                                project: projectId,
                                data: { content: v.content, access: true, origin: 'user' },
                              });
                              setForm(null);
                            },
                          })
                        }
                      >
                        {t('＋ Add memory')}
                      </button>,
                    )}
                    <div className="memory-status-grid">
                      <div className="memory-engine">
                        <span>◎</span>
                        <div>
                          <b>
                            {t(
                              memoryFailure !== null
                                ? memoryFailurePrefix
                                : (snapshot.memoryStatus ?? ''),
                            )}
                          </b>
                          {memoryFailure ? (
                            <details className="runtime-diagnostic">
                              <summary>{t('Memory runtime details')}</summary>
                              <pre>{memoryFailure}</pre>
                            </details>
                          ) : null}
                          <p>
                            {t(
                              'A small CPU model downloads on first use and is reused from its local cache. Keyword search stays available while it prepares.',
                            )}
                          </p>
                          <label>
                            <Switch
                              checked={settings.semanticSearch !== false}
                              onChange={(e) =>
                                void changeSettings({ semanticSearch: e.target.checked })
                              }
                            />
                            {t('Automatic semantic search')}
                          </label>
                        </div>
                        <button
                          onClick={() => void api.memoryEnable().catch(fail)}
                          disabled={
                            !snapshot.desktop ||
                            snapshot.memoryStatus?.startsWith('Preparing') ||
                            snapshot.memoryStatus?.startsWith('Semantic +')
                          }
                        >
                          {t('Prepare model now ↗')}
                        </button>
                      </div>
                      <div className="memory-engine consolidation-engine">
                        <span>✦</span>
                        <div>
                          <b>{t(snapshot.consolidationStatus ?? '')}</b>
                          <p>
                            {t(
                              'MiniCPM5-1B summarizes idle conversations and keeps source-linked facts. It downloads automatically, runs on CPU while the app is open, and releases the model when idle.',
                            )}
                          </p>
                          <label>
                            <Switch
                              checked={settings.autoConsolidation !== false}
                              onChange={(e) =>
                                void changeSettings({ autoConsolidation: e.target.checked })
                              }
                            />
                            {t('Automatic summaries & facts')}
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="memory-overview">
                      {[
                        [
                          'Conversation summaries',
                          entities.filter((m) => m.kind === 'memory' && m.data.type === 'summary')
                            .length,
                          'Compressed conversation batches, linked to their original messages.',
                        ],
                        [
                          'Saved facts & memories',
                          entities.filter((m) => m.kind === 'memory' && m.data.type !== 'summary')
                            .length,
                          'Explicitly saved memories and facts extracted from user statements.',
                        ],
                        [
                          'Awaiting review',
                          entities.filter(
                            (m) => m.kind === 'memory' && m.data.status === 'needs_review',
                          ).length,
                          'Conflicting facts are withheld from recall until you resolve them.',
                        ],
                      ].map(([label, count, description]) => (
                        <div key={label}>
                          <strong>{count}</strong>
                          <b>{t(String(label))}</b>
                          <p>{t(String(description))}</p>
                        </div>
                      ))}
                    </div>
                    <p className="memory-storage-note">
                      {t(
                        'Saved on this machine. Memory search retrieves relevant entries; excluded chats and inaccessible sources stay outside agent recall. Original conversations remain separate. Expand an entry to inspect its stored content, sources and current resource access.',
                      )}
                    </p>
                    <form
                      className="memory-search"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void api
                          .memorySearch(memoryQuery, { memoriesOnly: true })
                          .then(setMemoryResults)
                          .catch(fail);
                      }}
                    >
                      <input
                        aria-label={t('Search memories')}
                        value={memoryQuery}
                        onChange={(e) => setMemoryQuery(e.target.value)}
                        placeholder={t('Find a fact, a preference, a past discovery…')}
                      />
                      <button>{t('Search')}</button>
                      {memoryResults ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMemoryResults(null);
                            setMemoryQuery('');
                          }}
                        >
                          {t('Clear')}
                        </button>
                      ) : null}
                    </form>
                    <div className="memory-list">
                      {displayedMemories.map((m) => (
                        <article key={m.id}>
                          <span>✦</span>
                          <div>
                            <div className="memory-entry-heading">
                              <span className="memory-kind">
                                {t(
                                  m.data.type === 'summary'
                                    ? 'Conversation summary'
                                    : m.data.type === 'fact'
                                      ? 'Extracted fact'
                                      : m.data.origin === 'agent'
                                        ? 'Agent-saved memory'
                                        : m.data.origin === 'user'
                                          ? 'You saved this'
                                          : 'Saved memory',
                                )}
                              </span>
                              <h3>{m.title}</h3>
                            </div>
                            <p>{m.data.content}</p>
                            {m.data.type === 'summary' && isGenericSummary(m.data.content) ? (
                              <p className="memory-quality-note">
                                {t(
                                  'This older summary contains no specific details. Expand the sources below to see what was discussed.',
                                )}
                              </p>
                            ) : null}
                            <small>
                              {time(m.updated)} ·{' '}
                              {m.project ? find(m.project)?.title : t('Personal memory')}
                              {m.data.auto ? ' · MiniCPM5' : ''}
                              {m.data.agentProfile && find(m.data.agentProfile)
                                ? ' · ' + find(m.data.agentProfile)?.title
                                : ''}
                              {m.data.status === 'needs_review'
                                ? t(' · Conflicting fact — review before use')
                                : ''}
                              {m.data.status === 'superseded' ? t(' · Replaced') : ''}
                            </small>
                            {m.data.evidence ? (
                              <details>
                                <summary>{t('Source evidence')}</summary>
                                <blockquote>{m.data.evidence}</blockquote>
                              </details>
                            ) : null}
                            <MemoryDetails
                              memory={m}
                              onOpen={(id) => {
                                const source = find(id);
                                if (source) openEntity(source);
                              }}
                            />
                            {m.data.conversation && find(m.data.conversation) ? (
                              <button
                                className="quiet-button"
                                onClick={() => {
                                  setConversationId(m.data.conversation);
                                  setPage('chat');
                                }}
                              >
                                {t('View original conversation ↗')}
                              </button>
                            ) : null}
                          </div>
                          <Menu>
                            {m.data.status === 'needs_review' ? (
                              <button
                                onClick={() => void api.memoryResolve(m.id).then(boot).catch(fail)}
                              >
                                {t('Use this fact instead')}
                              </button>
                            ) : null}
                            <button
                              onClick={() =>
                                setForm({
                                  title: t('Edit memory'),
                                  values: { content: m.data.content ?? '' },
                                  fields: [
                                    { key: 'content', label: t('Memory'), type: 'textarea' },
                                  ],
                                  submit: async (v) => {
                                    await mutate({
                                      id: m.id,
                                      title: v.content.slice(0, 70),
                                      data: { content: v.content },
                                    });
                                    setForm(null);
                                  },
                                })
                              }
                            >
                              {t('Edit')}
                            </button>
                            <button className="danger" onClick={() => void trashEntity(m)}>
                              {t('Forget')}
                            </button>
                          </Menu>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
                {page === 'skills' ? (
                  <div className="page-pad skills-page">
                    {contentHeader(
                      t('A LITTLE KNOW-HOW'),
                      t('Useful things, learned once.'),
                      t('Reusable instructions that help your companion work thoughtfully.'),
                      <>
                        <select
                          aria-label={t('Skills view')}
                          data-tooltip={t(
                            'Choose cards to browse skills or a compact list to scan more at once.',
                          )}
                          value={settings.skillsView ?? 'cards'}
                          onChange={(e) =>
                            void changeSettings({
                              skillsView: e.target.value as Settings['skillsView'],
                            })
                          }
                        >
                          <option value="cards">{t('Cards')}</option>
                          <option value="list">{t('List')}</option>
                        </select>
                        <button
                          className="primary"
                          onClick={() =>
                            setForm({
                              title: t('A new skill'),
                              values: { title: '', content: '# Skill\n\n' },
                              fields: [
                                { key: 'title', label: t('Name') },
                                {
                                  key: 'content',
                                  label: t('Instructions (Markdown)'),
                                  type: 'textarea',
                                },
                              ],
                              submit: async (v) => {
                                await mutate({
                                  kind: 'skill',
                                  title: v.title,
                                  data: { content: v.content, access: true },
                                });
                                setForm(null);
                              },
                            })
                          }
                        >
                          {t('＋ New skill')}
                        </button>
                      </>,
                    )}
                    <label className="skills-learning-control">
                      <span>{t('Agent skill learning')}</span>
                      <select
                        aria-label={t('Agent skill learning')}
                        value={settings.skillLearning || 'automatic'}
                        onChange={(e) =>
                          void changeSettings({
                            skillLearning: e.target.value as Settings['skillLearning'],
                          })
                        }
                      >
                        <option value="automatic">{t('Create and use own skills')}</option>
                        <option value="review">{t('Save for my review')}</option>
                        <option value="off">{t('Off')}</option>
                      </select>
                    </label>
                    <div
                      className={
                        'resource-grid skills-grid app-collection' +
                        (settings.skillsView === 'list' ? ' resource-list' : '')
                      }
                      data-selection-surface
                    >
                      {entities
                        .filter((e) => e.kind === 'skill')
                        .slice(0, pageLimit)
                        .map((s) => (
                          <article
                            className="resource-card"
                            key={s.id}
                            data-selected={selectedIds.has(s.id)}
                            data-selection-id={s.id}
                            onClickCapture={(event) =>
                              selectItem(
                                s,
                                entities.filter((e) => e.kind === 'skill'),
                                event,
                              )
                            }
                          >
                            <span className="resource-icon">✳</span>
                            {menu(s)}
                            <h2>{s.title}</h2>
                            <p>{s.data.description || t('A reusable bit of know-how.')}</p>
                            {s.data.generated && (
                              <small>
                                {t('Learned by')} {s.data.creatorName} ·{' '}
                                {t(s.data.learningState || 'active')}
                              </small>
                            )}
                            <label className="check-label">
                              <Check
                                checked={s.data.access === true}
                                  onChange={(e) => void patch(s, { access: e.target.checked,
                                    ...(s.data.generated ? { learningState: e.target.checked ? 'active' : 'review' } : {}) })}
                              />{' '}
                              {t('Available to agent')}
                            </label>
                            <button
                              onClick={() =>
                                setForm({
                                  title: t('Edit skill'),
                                  values: { title: s.title, content: s.data.content ?? '' },
                                  fields: [
                                    { key: 'title', label: t('Name') },
                                    {
                                      key: 'content',
                                      label: t('SKILL.md instructions'),
                                      type: 'textarea',
                                    },
                                  ],
                                  submit: async (v) => {
                                    await mutate({
                                      id: s.id,
                                      title: v.title,
                                      data: { content: v.content },
                                    });
                                    setForm(null);
                                  },
                                })
                              }
                            >
                              {t('Open instructions ↗')}
                            </button>
                          </article>
                        ))}
                    </div>
                  </div>
                ) : null}
                {page === 'connections' ? (
                  <div className="page-pad">
                    {contentHeader(
                      t('OPEN POSSIBILITIES'),
                      t('A few helpful connections.'),
                      t('Bring in tools from local or remote MCP servers.'),
                      <button
                        className="primary"
                        onClick={() =>
                          setForm({
                            title: t('Connect a tool server'),
                            values: {
                              title: '',
                              transport: 'stdio',
                              command: '',
                              args: '',
                              url: '',
                            },
                            fields: [
                              { key: 'title', label: t('Name') },
                              {
                                key: 'transport',
                                label: t('Connection type'),
                                type: 'select',
                                options: [
                                  { value: 'stdio', label: t('Local process (stdio)') },
                                  { value: 'http', label: t('Remote HTTP') },
                                ],
                              },
                              { key: 'command', label: t('Local executable') },
                              { key: 'args', label: t('Arguments (JSON array)') },
                              { key: 'url', label: 'HTTP URL' },
                            ],
                            submit: async (v) => {
                              let args = [];
                              if (v.args) {
                                args = JSON.parse(v.args);
                                if (!Array.isArray(args) || args.some((x) => typeof x !== 'string'))
                                  throw new Error(t('Arguments must be a JSON array of strings'));
                              }
                              if (v.transport === 'http') new URL(v.url);
                              else if (!v.command.trim())
                                throw new Error(t('Provide a local executable'));
                              await mutate({
                                kind: 'connection',
                                title: v.title,
                                data: {
                                  transport: v.transport,
                                  command: v.command,
                                  args,
                                  url: v.url,
                                  enabled: false,
                                },
                              });
                              setForm(null);
                            },
                          })
                        }
                      >
                        {t('＋ Add connection')}
                      </button>,
                    )}
                    <div className="resource-grid">
                      {entities
                        .filter((e) => e.kind === 'connection')
                        .map((c) => (
                          <article className="resource-card" key={c.id}>
                            <span className="resource-icon">⌁</span>
                            {menu(c)}
                            <h2>{c.title}</h2>
                            <p>{c.data.transport === 'http' ? c.data.url : c.data.command}</p>
                            <span className="pill">
                              {c.data.enabled ? t('Enabled') : t('Disconnected')}
                            </span>
                            <button
                              onClick={() =>
                                void (c.data.enabled ? api.disconnect(c.id) : api.connect(c.id))
                                  .then((result) => {
                                    if (result?.tools)
                                      setSaveNotice(
                                        t('Connected · ') + result.tools.length + t(' tools'),
                                      );
                                  })
                                  .catch(fail)
                              }
                            >
                              {c.data.enabled ? t('Disconnect') : t('Connect & discover tools')} ↗
                            </button>
                          </article>
                        ))}
                    </div>
                    {!entities.some((e) => e.kind === 'connection') ? (
                      <div className="empty-state">
                        <span>⌁</span>
                        <h2>{t('A broader set of hands.')}</h2>
                        <p>
                          {t('Connect a server to add tools.')}
                          <br />
                          {t('Intelligence will show connected actions for your approval.')}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {page === 'system' ? (
                  <Machine
                    report={system}
                    name={deviceName}
                    profile={machineProfile}
                    onRefresh={async () => {
                      try {
                        setSystem(await api.system());
                      } catch (error) {
                        fail(error);
                      }
                    }}
                    onPrepare={async () => {
                      try {
                        const profile = await api.prepareMachine();
                        await boot();
                        const chat = await mutate({
                          kind: 'conversation',
                          title: t('Understanding ') + profile.title,
                          project: null,
                          data: { context: [profile.id], readOnlyMachine: true },
                        });
                        setConversationId(chat.id);
                        setPage('chat');
                      } catch (error) {
                        fail(error);
                      }
                    }}
                    onDisconnect={async () => {
                      if (machineProfile)
                        await patch(machineProfile, { ready: false, access: false });
                    }}
                    onShareLogs={async (logContext) => {
                      try {
                        const profile = await api.prepareMachine();
                        await boot();
                        const chat = await mutate({
                          kind: 'conversation',
                          title: t('Logs · ') + logContext.source,
                          project: null,
                          data: {
                            context: [profile.id],
                            readOnlyMachine: true,
                            temporary: true,
                            logContext,
                          },
                        });
                        setConversationId(chat.id);
                        setPage('chat');
                      } catch (error) {
                        fail(error);
                      }
                    }}
                  />
                ) : null}
              </Suspense>
            </div>
            {assistantPanel}
          </div>
          {!snapshot.desktop ? (
            <div className="preview-banner">
              {t(
                'Browser preview · Machine readings are live. Agent inference runs in the Electron app.',
              )}
            </div>
          ) : null}
        </main>
      </div>

      {conversationsOpen && (
        <Suspense fallback={<p>{t('Opening conversations…')}</p>}>
          <ConversationLibrary
            all={entities}
            onClose={() => setConversationsOpen(false)}
            onChanged={boot}
            onError={fail}
            onOpen={(e) => {
              setConversationsOpen(false);
              openEntity(e);
            }}
          />
        </Suspense>
      )}
      {pendingReport && pendingReport.delivery !== 'quiet' && (
        <div className="toast report-ready-toast" role="status">
          <span>
            {t('Report ready')} · {pendingReport.summary}
          </span>
          <button
            onClick={() => {
              setReportId(pendingReport.id);
              setPage('reports');
              setPendingReport(null);
            }}
          >
            {t('Open report')}
          </button>
          <button aria-label={t('Dismiss notification')} onClick={() => setPendingReport(null)}>
            ×
          </button>
        </div>
      )}
      {error ? (
        <div className="toast error-toast" role="alert">
          <span>!</span>
          <p>{t(error)}</p>
          <button aria-label={t('Dismiss error')} onClick={() => setError('')}>
            ×
          </button>
        </div>
      ) : null}
      {saveNotice ? (
        <div className="toast" role="status">
          {t(saveNotice)}
          <button aria-label={t('Dismiss notification')} onClick={() => setSaveNotice('')}>
            ×
          </button>
        </div>
      ) : null}
      {form ? <FormDialog form={form} onClose={() => setForm(null)} onError={fail} /> : null}
      {['notebooks', 'projects', 'skills'].includes(page) &&
      (page === 'notebooks'
        ? notebooks.length
        : page === 'projects'
          ? projects.length
          : entities.filter((e) => e.kind === 'skill').length) > pageLimit ? (
        <button className="collection-more" onClick={() => setPageLimit((v) => v + 120)}>
          {t('Load more')}
        </button>
      ) : null}
      {selectedIds.size ? (
        <BulkBar
          items={entities.filter((e) => selectedIds.has(e.id))}
          all={entities}
          onDone={() => {
            setSelectedIds(new Set());
            void boot();
          }}
          onError={fail}
        />
      ) : null}
      {activityOpen ? (
        <ActivityPanel
          snapshot={snapshot}
          onOpen={openEntity}
          onClose={() => setActivityOpen(false)}
          onError={fail}
        />
      ) : null}
      {guideOpen ? (
        <Onboarding
          snapshot={snapshot}
          onClose={() => {
            setGuideOpen(false);
            void changeSettings({ onboardingComplete: true });
          }}
          onSettings={() => {
            setGuideOpen(false);
            setSettingsOpen('models');
            void changeSettings({ onboardingComplete: true });
          }}
        />
      ) : null}
      {searchOpen ? (
        <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
          <section
            className="search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('Find anything')}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Find a note, project, task, or conversation…')}
              aria-label={t('Global search')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  e.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>('button')
                    ?.focus();
                }
                if (e.key === 'Enter' && paletteCommands[0]) {
                  e.preventDefault();
                  setSearchOpen(false);
                  paletteCommands[0].run();
                }
              }}
            />
            {paletteCommands.length ? (
              <>
                <h3>{t('Commands')}</h3>
                {paletteCommands.map((command) => (
                  <button
                    key={command.id}
                    onClick={() => {
                      setSearchOpen(false);
                      command.run();
                    }}
                  >
                    <span>{command.label}</span>
                    <small>{t('Command')}</small>
                  </button>
                ))}
              </>
            ) : null}
            {searchResults.length ? <h3>{t('Your work')}</h3> : null}
            {searchResults.map((e) => (
              <button key={e.id} onClick={() => openEntity(e)}>
                <span>
                  {e.title}
                  <small>{e.kind}</small>
                </span>
                <span>↗</span>
              </button>
            ))}
            {!search ? <p>{t('Every thought has a place. Find yours.')}</p> : null}
          </section>
        </div>
      ) : null}
      {accessOpen ? (
        <div className="modal-backdrop" onClick={() => setAccessOpen(false)}>
          <section
            className="access-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="access-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <span className="eyebrow">{t('IN THE PICTURE')}</span>
              <button
                className="icon-button"
                aria-label={t('Close access settings')}
                onClick={() => setAccessOpen(false)}
              >
                ×
              </button>
            </header>
            <h2 id="access-title">{t('Choose what we work with.')}</h2>
            <p>
              {t(
                'Access makes something available. Context picks what matters for this conversation. Assignment tells the agent to do the work.',
              )}
            </p>
            <label className="access-master">
              <Check
                checked={page === 'tasks' ? settings.kanbanAccess : settings.notebookAccess}
                onChange={(e) =>
                  void changeSettings(
                    page === 'tasks'
                      ? { kanbanAccess: e.target.checked }
                      : { notebookAccess: e.target.checked },
                  )
                }
              />{' '}
              {t('Enable agent access to')} {page === 'tasks' ? t('Tasks') : t('Notebooks')}
            </label>
            <div className="access-tree">
              {(selectedRoot ? [selectedRoot] : page === 'tasks' ? boards : notebooks).map(
                (root) => (
                  <AccessBranch
                    key={root.id}
                    entity={root}
                    entities={entities}
                    settings={settings}
                    patch={patch}
                  />
                ),
              )}
            </div>
            <div className="access-footer">
              <small>
                {t('New items inherit their parent’s access.')}
                <br />
                {t('Read & edit includes creating and moving items to Trash.')}
              </small>
              <button className="primary" onClick={() => setAccessOpen(false)}>
                {t('Done')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {settingsOpen && (
        <SettingsDialog
          section={settingsOpen}
          settings={settings}
          snapshot={snapshot}
          onSection={setSettingsOpen}
          onSettings={changeSettings}
          onChanged={boot}
          onError={fail}
          onAgent={() => {
            setSettingsOpen(null);
            setPage('agent');
          }}
          onGuide={() => setGuideOpen(true)}
          onTrash={() => setTrashOpen(true)}
          trashOpen={trashOpen}
          guideOpen={guideOpen}
        />
      )}
      {trashOpen ? <TrashDialog onClose={() => setTrashOpen(false)} /> : null}
    </div>
  );
}
function AccessBranch({
  entity,
  entities,
  settings,
  patch,
}: {
  entity: Entity;
  entities: Entity[];
  settings: Settings;
  patch: (e: Entity, d: any) => Promise<any>;
}) {
  const child = entities.filter((e) => e.parent === entity.id),
    checked = allowed(entity, entities, settings),
    states = child.map((e) => allowed(e, entities, settings)),
    mixed = states.some(Boolean) && (!checked || states.some((s) => !s));
  return (
    <div className="access-branch">
      <div>
        <label>
          <Check
            checked={checked && !mixed}
            mixed={mixed}
            onChange={(e) => void patch(entity, { access: e.target.checked })}
          />
          <span>
            {entity.data.icon ?? (entity.kind === 'note' ? '≡' : '⌑')} {entity.title}
            <small>
              {entity.data.access == null
                ? t('Inherited')
                : entity.data.access
                  ? t('Included')
                  : t('Excluded')}{' '}
              · {entity.kind}
            </small>
          </span>
        </label>
        <select
          aria-label={t('Access permission for ') + entity.title}
          value={entity.data.permission ?? 'inherit'}
          onChange={(e) =>
            void patch(entity, { permission: e.target.value === 'inherit' ? null : e.target.value })
          }
        >
          <option value="inherit">{t('Inherit')}</option>
          <option value="read">{t('Read only')}</option>
          <option value="edit">{t('Read & edit')}</option>
        </select>
        {entity.data.access != null ? (
          <button
            className="icon-button"
            aria-label={t('Reset inherited access for ') + entity.title}
            onClick={() => void patch(entity, { access: null })}
          >
            ↶
          </button>
        ) : null}
      </div>
      {child.length ? (
        <details open>
          <summary>
            {child.length} {t('items')}
          </summary>
          {child.map((e) => (
            <AccessBranch
              key={e.id}
              entity={e}
              entities={entities}
              settings={settings}
              patch={patch}
            />
          ))}
        </details>
      ) : null}
    </div>
  );
}
function FormDialog({
  form,
  onClose,
  onError,
}: {
  form: Form;
  onClose: () => void;
  onError: (e: any) => void;
}) {
  const [values, setValues] = useState(form.values),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className={'form-dialog' + (form.fields.some(f => f.label === t('SKILL.md instructions')) ? ' skill-editor-dialog' : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await form.submit(values);
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <span className="eyebrow">{t('A LITTLE POSSIBILITY')}</span>
          <button
            className="icon-button"
            type="button"
            aria-label={t('Close dialog')}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <h2 id="form-title">{form.title}</h2>
        {form.subtitle ? <p>{form.subtitle}</p> : null}
        {form.fields.map((field, i) => (
          <label key={field.key}>
            {t(field.label)}
            {field.type === 'textarea' ? (
              <textarea
                rows={field.key === 'content' ? 9 : 3}
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            ) : field.type === 'cover' ? (
              <div className="cover-picker">
                <select
                  aria-label={t('Cover style')}
                  value={coverColor(values[field.key]) ? 'color' : values[field.key]}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [field.key]: e.target.value === 'color' ? coverColors[0][1] : e.target.value,
                    }))
                  }
                >
                  <option value="color">{t('Solid color')}</option>
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.label)}
                    </option>
                  ))}
                </select>
                <div className="cover-swatches" role="group" aria-label={t('Cover color presets')}>
                  {coverColors.map(([name, color]) => (
                    <button
                      type="button"
                      key={color}
                      title={t(name)}
                      aria-label={t(name)}
                      aria-pressed={values[field.key] === color}
                      style={{ backgroundColor: color }}
                      onClick={() => setValues((v) => ({ ...v, [field.key]: color }))}
                    />
                  ))}
                </div>
                <div className="cover-custom-color">
                  <span>{t('Custom cover color')}</span>
                  <input
                    type="color"
                    aria-label={t('Custom cover color')}
                    value={coverColor(values[field.key]) ?? coverColors[0][1]}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  />
                </div>
              </div>
            ) : field.type === 'select' ? (
              <select
                aria-label={t(field.label)}
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              >
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            ) : field.type === 'icon' ? (
              <div className="icon-picker">
                {icons.map((icon) => (
                  <button
                    type="button"
                    key={icon}
                    className={values[field.key] === icon ? 'selected' : ''}
                    aria-label={t('Choose icon ') + icon}
                    onClick={() => setValues((v) => ({ ...v, [field.key]: icon }))}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            ) : (
              <input
                autoFocus={i === 0}
                required={field.key === 'title'}
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            )}
          </label>
        ))}
        <footer>
          <button type="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? t('Saving…') : (form.button ?? t('Save'))}
          </button>
        </footer>
      </form>
    </div>
  );
}
function localDate(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
