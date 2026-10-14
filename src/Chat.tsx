import { t } from './i18n';
import { memo, useEffect, useRef, useState, useId } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import ZimReader from './ZimReader';
import remarkGfm from 'remark-gfm';
import type { AgentEvent, Entity, Message, Settings } from './types';
import { api } from './api';
import ThemeArt from './ThemeArt';
import { themeCopy } from './themes';
import { logoPath } from './branding';
import Icon from './Icon';
import ChatModelMenu from './ChatModelMenu';
import ContextMeter from './ContextMeter';
import { speak, stopPlayback, dictate } from './speech';
import { approvalChoices } from './ChatPreferences';
import { chatRows, toolFailed } from './chat-rows';
const markdownPlugins = [remarkGfm];
function ResponseChanges({ message, conversation }: { message: Message; conversation: Entity }) {
  const [receipt, setReceipt] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    api
      .workspace({ action: 'receipt', id: conversation.id, message: message.id })
      .then((v) => {
        if (alive) setReceipt(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [message.id, conversation.id]);
  if (!receipt?.changes?.length) return null;
  return (
    <details className="response-changes">
      <summary>{t('Changes')}</summary>
      {receipt.changes.map((r: any) => (
        <p key={r.id}>
          {r.title ?? t('Source no longer available')}
          {r.title ? (
            <button
              disabled={r.undone}
              onClick={() =>
                void api
                  .workspace({ action: 'undo-change', ...r })
                  .then(() =>
                    setReceipt({
                      ...receipt,
                      changes: receipt.changes.map((v: any) =>
                        v.id === r.id ? { ...v, undone: true } : v,
                      ),
                    }),
                  )
                  .catch((e) => setReceipt({ ...receipt, undoError: e.message }))
              }
            >
              {t('Undo change')}
            </button>
          ) : null}
        </p>
      ))}
      {receipt.undoError ? <p role="status">{t(receipt.undoError)}</p> : null}
    </details>
  );
}
function ThinkingPanel({
  text,
  open,
  toggle,
  live = false,
}: {
  text: string;
  open: boolean;
  toggle: () => void;
  live?: boolean;
}) {
  const body = useRef<HTMLPreElement>(null);
  const id = useId();
  useEffect(() => {
    if (live && !open && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, open, live]);
  return (
    <section
      className={
        'model-thinking thinking-panel' + (live ? ' live' : '') + (open ? ' expanded' : ' vignette')
      }
    >
      <button
        className="thinking-toggle"
        aria-controls={id}
        aria-label={t(open ? 'Hide thinking' : 'Show thinking')}
        aria-expanded={open}
        onClick={toggle}
        title={t(open ? 'Hide thinking' : 'Show thinking')}
      >
        <Icon name="brain" />
        <span>{t('Thinking')}</span>
      </button>
      <pre id={id} ref={body}>
        {text}
      </pre>
    </section>
  );
}
// Opening Settings or changing status must not reparse every completed message.
const MessageBody = memo(function MessageBody({ content }: { content: string }) {
  const [source, setSource] = useState(''),
    [error, setError] = useState('');
  return (
    <>
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        urlTransform={(url) => (url.startsWith('zim://archive/') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                if (href?.startsWith('zim://archive/')) {
                  e.preventDefault();
                  setSource(href);
                } else if (href && window.intelligence && /^https?:\/\//.test(href)) {
                  e.preventDefault();
                  void api
                    .workspace({ action: 'open-source-link', url: href })
                    .catch((e) => setError(e.message));
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {source ? <ZimReader reference={source} onClose={() => setSource('')} /> : null}
      {error ? <p role="status">{t(error)}</p> : null}
    </>
  );
});
export default function Chat({
  settings,
  conversation,
  context,
  onNew,
  onSettings,
  compact = false,
  onError,
  running = false,
  pendingApprovals = [],
  onBranched,
  screenFocus,
}: {
  settings: Settings;
  conversation: Entity | null;
  context: Entity[];
  onNew: (context: string[]) => Promise<Entity>;
  onSettings: () => void;
  compact?: boolean;
  onError: (s: string) => void;
  running?: boolean;
  pendingApprovals?: AgentEvent[];
  onBranched?: (e: Entity) => void;
  screenFocus?: { section: string; mode: string; entities: string[] };
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(''),
    [stream, setStream] = useState(''),
    [busy, setBusy] = useState(false),
    [activity, setActivity] = useState(''),
    [approvals, setApprovals] = useState<AgentEvent[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [branching, setBranching] = useState(false);
  const [spokenMessage, setSpokenMessage] = useState(''),
    [speechState, setSpeechState] = useState('');
  const speechPreferences = useRef(settings);
  speechPreferences.current = settings;
  const autoReadTurn = useRef('');
  const readMessage = (message: Message) => {
    setSpokenMessage(message.id);
    const fail = (e: any) => onError(e?.message || String(e));
    void speak(message.content, fail, setSpeechState).catch(fail);
  };
  const readLatest = useRef(readMessage);
  readLatest.current = readMessage;
  useEffect(() => {
    if (!settings.autoReadAloud || !settings.optionalModules?.tts?.enabled) stopPlayback();
  }, [settings.autoReadAloud, settings.optionalModules?.tts?.enabled]);
  const [dictating, setDictating] = useState(false),
    [partialSpeech, setPartialSpeech] = useState('');
  const stopMic = useRef<((finish?: boolean) => Promise<void>) | null>(null);
  useEffect(
    () => () => {
      void stopMic.current?.(false);
      stopPlayback();
    },
    [],
  );
  const branchLock = useRef(false);
  const [thinkingStates, setThinkingStates] = useState<Record<string, boolean>>({});
  const [liveThinkingOpen, setLiveThinkingOpen] = useState(false);
  const liveState = useRef({ text: '', open: false });
  const savedThinking = useRef({ text: '', open: false });
  const [thinking, setThinking] = useState(''),
    [info, setInfo] = useState<any>(null),
    [compacting, setCompacting] = useState(false),
    [copied, setCopied] = useState<string | null>(null);
  const loadInfo = () => {
    const id = convo.current?.id;
    if (id)
      api
        .chatInfo(id)
        .then((value) => {
          if (mounted.current && convo.current?.id === id) setInfo(value);
        })
        .catch(() => {});
  };
  const copy = async (message: Message) => {
    try {
      await api.copy(message.content);
      setCopied(message.id);
      setTimeout(() => {
        if (mounted.current) setCopied(null);
      }, 2000);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const end = useRef<HTMLDivElement>(null),
    pane = useRef<HTMLDivElement>(null),
    convo = useRef(conversation),
    loadVersion = useRef(0),
    mounted = useRef(false),
    followingLatest = useRef(true);
  convo.current = conversation;
  liveState.current = { text: thinking, open: liveThinkingOpen };
  const toggleThinking = (id: string) =>
    setThinkingStates((v) => ({
      ...Object.fromEntries(Object.entries(v).slice(-127)),
      [id]: !v[id],
    }));
  useEffect(() => {
    const scroll = pane.current;
    if (!scroll) return;
    const update = () =>
      scroll.parentElement?.style.setProperty(
        '--chat-scrollbar',
        Math.max(0, scroll.offsetWidth - scroll.clientWidth) + 'px',
      );
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    update();
    return () => observer.disconnect();
  }, []);
  const responding = busy || running || compacting;
  const [sendingSteer, setSendingSteer] = useState(false);
  const canSteer = responding && !compacting && !conversation?.data.matrixTask;
  const load = () => {
    const id = convo.current?.id,
      version = ++loadVersion.current,
      pendingThinking = liveState.current.text
        ? { ...liveState.current }
        : { ...savedThinking.current };
    if (pendingThinking.text) savedThinking.current = pendingThinking;
    if (id)
      void api
        .messages(id)
        .then((next) => {
          if (mounted.current && version === loadVersion.current && convo.current?.id === id) {
            setMessages(next);
            if (autoReadTurn.current === id) {
              autoReadTurn.current = '';
              const answer = [...next]
                .reverse()
                .find(
                  (m) =>
                    m.role === 'assistant' &&
                    !m.data.tool &&
                    !m.data.error &&
                    !m.data.modelMessage?.tool_calls?.length &&
                    m.content.trim(),
                );
              if (
                answer &&
                speechPreferences.current.autoReadAloud &&
                speechPreferences.current.optionalModules?.tts?.enabled
              )
                readLatest.current(answer);
            }
            const finished = [...next]
              .reverse()
              .find((m) =>
                String(
                  m.data.modelMessage?.thinking ?? m.data.modelMessage?.reasoning_content ?? '',
                ).startsWith(pendingThinking.text),
              );
            if (pendingThinking.text && finished) {
              setThinkingStates((v) => ({ ...v, [finished.id]: pendingThinking.open }));
              savedThinking.current = { text: '', open: false };
            }
          }
        })
        .catch((e) => {
          if (mounted.current && version === loadVersion.current) onError(e.message);
        });
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadVersion.current++;
    };
  }, []);
  useEffect(() => {
    followingLatest.current = true;
    savedThinking.current = { text: '', open: false };
    autoReadTurn.current = '';
    stopPlayback();
    setSpokenMessage('');
    setStream('');
    setThinking('');
    setInfo(null);
    setLiveThinkingOpen(false);
    setBusy(false);
    setApprovals([]);
    setImages([]);
    if (conversation) load();
    if (conversation) loadInfo();
    else setMessages([]);
  }, [conversation?.id]);
  useEffect(() => {
    setApprovals(pendingApprovals.filter((e) => e.conversation === conversation?.id));
  }, [conversation?.id, pendingApprovals.map((e) => e.id).join(',')]);
  useEffect(
    () =>
      api.onEvent((e) => {
        if (e.type === 'changed') load();
        if (e.conversation !== convo.current?.id && e.type !== 'approval-resolved') return;
        if (e.type === 'delta') {
          setStream((s) => s + e.text);
          setBusy(true);
        }
        if (e.type === 'thinking') setThinking((s) => s + (e.text ?? ''));
        if (e.type === 'metrics') loadInfo();
        if (e.type === 'compacting') {
          setCompacting(e.status === 'running');
          if (e.status !== 'running') loadInfo();
        }
        if (e.type === 'segment') {
          setStream('');
          setThinking('');
          load();
        }
        if (e.type === 'tool')
          setActivity(
            e.status === 'running'
              ? (e.repair ? t('Corrected tool formatting · ') : t('Using ')) +
                  e.name?.replaceAll('_', ' ')
              : '',
          );
        if (['done', 'error'].includes(e.type)) {
          if (e.type === 'done' && !e.error) autoReadTurn.current = e.conversation || '';
          setBusy(false);
          setStream('');
          setActivity('');
          load();
          setThinking('');
        }
        if (e.type === 'approval') setApprovals((a) => [...a, e]);
        if (e.type === 'approval-resolved') setApprovals((a) => a.filter((x) => x.id !== e.id));
      }),
    [],
  );
  useEffect(() => {
    const p = pane.current;
    if (p && followingLatest.current && settings.followLatest !== false)
      p.scrollTo({ top: p.scrollHeight, behavior: 'instant' });
  }, [messages, stream, thinking, approvals, activity, settings.followLatest]);
  async function send(text = draft) {
    if (responding) {
      if (!canSteer || !conversation || !text.trim() || sendingSteer) return;
      setSendingSteer(true);
      try {
        await api.chat({ conversation: conversation.id, text, context: [] });
        setDraft('');
        load();
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setSendingSteer(false);
      }
      return;
    }
    if (!text.trim() && !images.length) return;
    if (!settings.model && !conversation?.data.matrixTask) {
      onSettings();
      return;
    }
    try {
      setLiveThinkingOpen(false);
      let c = conversation;
      if (!c) c = await onNew(context.map((e) => e.id));
      convo.current = c;
      setDraft('');
      setBusy(true);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          conversation: c!.id,
          role: 'user',
          content: text,
          data: {},
          created: new Date().toISOString(),
        },
      ]);
      const result = await api.chat({
        conversation: c.id,
        text,
        context: context.map((e) => e.id),
        screenFocus,
        images,
      });
      setImages([]);
      if (result.queued && !result.started) setBusy(false);
    } catch (e) {
      setBusy(false);
      onError((e as Error).message);
    }
  }
  const empty = messages.length === 0 && !stream;
  return (
    <div className={'chat-surface ' + (compact ? 'compact' : '')}>
      <div
        className="chat-scroll"
        ref={pane}
        onScroll={(e) => {
          const p = e.currentTarget;
          followingLatest.current = p.scrollHeight - p.scrollTop - p.clientHeight < 80;
        }}
      >
        {empty && !compact ? (
          <div className="welcome">
            <div className="welcome-orbit">
              <ThemeArt category={0} variant="banner" />
            </div>
            <span className="eyebrow">{t('A LITTLE CLARITY, A LOT OF POSSIBILITY')}</span>
            <h1>
              {t(themeCopy(settings.theme).heading)}
              <br />
              <em>{t(themeCopy(settings.theme).emphasis)}</em>
            </h1>
            <p>
              {t(themeCopy(settings.theme).copy)}
              <br />
              {t('What would you like to explore?')}
            </p>
          </div>
        ) : null}
        {empty && compact ? (
          <div className="context-welcome">
            <div className="mini-orbit">
              <img src={settings.avatar || logoPath(settings.logoIcon)} alt="" />
            </div>
            <h3>
              {t('A thought partner,')}
              <br />
              {t('right here.')}
            </h3>
            <p>
              {t('Ask about')} {context.length ? context[0].title : t('your current work')}
              {t(', shape an idea, or make a little progress.')}
            </p>
            <button
              className="suggestion-link"
              onClick={() => setDraft(t('Summarize this and suggest a useful next step.'))}
            >
              {t('Summarize & suggest a next step ↗')}
            </button>
          </div>
        ) : null}
        {chatRows(messages).map((row) => {
          if (row.kind === 'tools') {
            const calls = row.messages.filter((m) => m.data.tool && !m.data.modelOnly);
            const failures = calls.filter(toolFailed).length;
            return (
              <details className="tool-message tool-group" key={row.messages[0].id}>
                <summary>
                  ⌘ {t('Tool calls')} · {calls.length}
                  {failures ? (
                    <span className="tool-failure">
                      {' '}
                      · {t('Failed')}: {failures}
                    </span>
                  ) : null}
                </summary>
                <div className="tool-group-body">
                  {row.messages.map((m) =>
                    m.data.modelOnly ? (
                      settings.showThinking &&
                      (m.data.modelMessage?.thinking || m.data.modelMessage?.reasoning_content) ? (
                        <ThinkingPanel
                          key={m.id}
                          text={
                            m.data.modelMessage.thinking ?? m.data.modelMessage.reasoning_content
                          }
                          open={!!thinkingStates[m.id]}
                          toggle={() => toggleThinking(m.id)}
                        />
                      ) : null
                    ) : (
                      <details className="tool-call" key={m.id}>
                        <summary>
                          {m.data.name?.replaceAll('_', ' ')}
                          {toolFailed(m) ? (
                            <span className="tool-failure"> · {t('Failed')}</span>
                          ) : null}
                        </summary>
                        <pre>{m.content}</pre>
                      </details>
                    ),
                  )}
                </div>
              </details>
            );
          }
          const m = row.message;
          return m.data.modelOnly ? (
            settings.showThinking &&
            (m.data.modelMessage?.thinking || m.data.modelMessage?.reasoning_content) ? (
              <ThinkingPanel
                key={m.id}
                text={m.data.modelMessage.thinking ?? m.data.modelMessage.reasoning_content}
                open={!!thinkingStates[m.id]}
                toggle={() => toggleThinking(m.id)}
              />
            ) : null
          ) : m.data.tool ? (
            <details className="tool-message" key={m.id}>
              <summary>⌘ {m.data.name?.replaceAll('_', ' ')}</summary>
              <pre>{m.content}</pre>
            </details>
          ) : (
            <article className={'message ' + m.role + (m.data.error ? ' error' : '')} key={m.id}>
              <div className="message-label">
                {m.role === 'user' ? t('You') : (m.data.agentName ?? settings.agentName)}
              </div>
              {settings.showThinking &&
              (m.data.modelMessage?.thinking || m.data.modelMessage?.reasoning_content) ? (
                <ThinkingPanel
                  text={m.data.modelMessage.thinking ?? m.data.modelMessage.reasoning_content}
                  open={!!thinkingStates[m.id]}
                  toggle={() => toggleThinking(m.id)}
                />
              ) : null}
              <MessageBody content={m.content} />
              {m.role === 'assistant' && conversation && m.data.receipt ? (
                <ResponseChanges message={m} conversation={conversation} />
              ) : null}
              {m.role === 'assistant' &&
              conversation &&
              onBranched &&
              !conversation.data.task &&
              !conversation.data.matrixTask &&
              !conversation.data.readOnlyMachine &&
              !m.data.error ? (
                <button
                  className="branch-control message-symbol-button"
                  aria-label={t('Branch from here')}
                  title={t('Branch from here')}
                  disabled={responding || branching}
                  onClick={() => {
                    if (branchLock.current) return;
                    branchLock.current = true;
                    setBranching(true);
                    void api
                      .workspace({ action: 'branch', id: conversation.id, message: m.id })
                      .then((e) => onBranched?.(e))
                      .catch((e) => onError(e.message))
                      .finally(() => {
                        branchLock.current = false;
                        setBranching(false);
                      });
                  }}
                >
                  <Icon name="git-branch" />
                </button>
              ) : null}
              {m.data.images?.length ? (
                <div className="chat-images">
                  {m.data.images.map((url: string) => (
                    <img loading="lazy" key={url} src={url} alt={t('Message image')} />
                  ))}
                </div>
              ) : null}
              {m.role === 'assistant' && settings.optionalModules?.tts?.enabled ? (
                <button
                  className="speak-message message-symbol-button"
                  aria-label={t(
                    spokenMessage === m.id && speechState ? 'Stop audio' : 'Read aloud',
                  )}
                  title={t(spokenMessage === m.id && speechState ? 'Stop audio' : 'Read aloud')}
                  data-tooltip={t(
                    spokenMessage === m.id && speechState ? 'Stop audio' : 'Read aloud',
                  )}
                  onClick={() => {
                    if (spokenMessage === m.id && speechState) {
                      stopPlayback();
                      return;
                    }
                    readMessage(m);
                  }}
                >
                  <Icon name={spokenMessage === m.id && speechState ? 'square' : 'volume-2'} />
                </button>
              ) : null}
              {spokenMessage === m.id && speechState ? (
                <small className="message-speech-status" role="status">
                  {t(speechState)}
                </small>
              ) : null}
              <button
                className="copy-message"
                aria-label={t('Copy message')}
                onClick={() => void copy(m)}
              >
                {copied === m.id ? t('Copied') : t('Copy')}
              </button>
            </article>
          );
        })}
        {settings.showThinking && thinking ? (
          <ThinkingPanel
            text={thinking}
            live
            open={liveThinkingOpen}
            toggle={() => setLiveThinkingOpen((v) => !v)}
          />
        ) : null}
        {stream ? (
          <article className="message assistant">
            <div className="message-label">{settings.agentName}</div>
            <MessageBody content={stream} />
          </article>
        ) : null}
        {responding ? (
          <div className="thinking">
            <span />
            {activity || t('Thinking through it…')}
          </div>
        ) : null}
        {approvals.map((a) => (
          <div className="approval" key={a.id}>
            <b>{a.summary}</b>
            <pre>{a.details}</pre>
            <div>
              <button onClick={() => void api.approve(a.id!, false)}>{t('Decline')}</button>
              <button className="primary" onClick={() => void api.approve(a.id!, true)}>
                {t('Approve action')}
              </button>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="compose-wrap">
        {!!conversation?.data.pendingSteering?.length && (
          <details className="pending-corrections">
            <summary>
              {t('Pending corrections')} · {conversation.data.pendingSteering.length}
            </summary>
            <div>
              {conversation.data.pendingSteering.map((text: string, index: number) => (
                <p key={index}>{text}</p>
              ))}
            </div>
          </details>
        )}
        {canSteer && (
          <small className="steering-hint" role="status">
            {t(
              conversation?.data.pendingSteering?.length
                ? 'Correction pending · delivered after the current model or tool step.'
                : 'Send a correction while the agent works. It applies at the next model/tool boundary.',
            )}
          </small>
        )}
        {conversation ? (
          <div className="chat-metrics">
            {info ? (
              <>
                <ContextMeter info={info} />
                {info.metrics ? (
                  <span title={info.metrics?.speedBasis}>
                    {info.metrics.estimated ? '~' : ''}
                    {info.metrics.lastTPS?.toFixed(1)} {t('tok/s')} ·{' '}
                    {info.metrics.averageTPS?.toFixed(1)} {t('avg')}
                  </span>
                ) : null}
              </>
            ) : null}
            <button
              disabled={responding || compacting}
              onClick={() => {
                setCompacting(true);
                api
                  .compact(conversation.id)
                  .then(loadInfo)
                  .catch((e) => onError(e.message))
                  .finally(() => setCompacting(false));
              }}
            >
              {compacting ? t('Compacting…') : t('Compact context')}
            </button>
          </div>
        ) : null}
        {conversation && !conversation.data.temporary && !conversation.data.logContext ? (
          <label className="chat-memory-control">
            <input
              type="checkbox"
              checked={conversation.data.memoryExcluded !== true}
              onChange={(e) =>
                void api
                  .mutate({ id: conversation.id, data: { memoryExcluded: !e.target.checked } })
                  .catch((e) => onError(e.message))
              }
            />
            {t('Allow this chat in memory & past-conversation search')}
          </label>
        ) : null}
        {conversation?.data.logContext ? (
          <details className="attached-logs">
            <summary>
              ☷ {conversation.data.logContext.entries.length} {t('selected log entries ·')}{' '}
              {conversation.data.logContext.source}
            </summary>
            <pre>
              {conversation.data.logContext.entries
                .map((entry: any) =>
                  [entry.timestamp, entry.unit, entry.message].filter(Boolean).join(' · '),
                )
                .join('\n\n')}
            </pre>
            <button
              onClick={() =>
                void api
                  .mutate({ id: conversation.id, data: { logContext: null } })
                  .catch((e) => onError(e.message))
              }
            >
              {t('Remove log context')}
            </button>
          </details>
        ) : null}
        {context.length ? (
          <div className="context-chips">
            {context.slice(0, 4).map((e) => (
              <span key={e.id}>✳ {e.title}</span>
            ))}
          </div>
        ) : null}
        <div className="composer">
          {images.length ? (
            <div className="chat-images">
              {images.map((url, i) => (
                <span key={url}>
                  <img src={url} alt={t('Attached image')} />
                  <button
                    aria-label={t('Remove attached image')}
                    onClick={() => setImages((old) => old.filter((_, index) => index !== i))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            aria-label={compact ? t('Message contextual assistant') : t('Message Intelligence')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              canSteer
                ? t('Guide the current response…')
                : compact
                  ? t('A question, an idea…')
                  : t('Ask anything. Make something. Figure it out.')
            }
            rows={compact ? 3 : 2}
          />
          <div className="composer-bottom">
            <div className="composer-tools chat-controls">
              {conversation?.data.matrixTask ? (
                <div className="matrix-model-control">
                  <select
                    className="composer-select chat-model-select"
                    aria-label={t('Choose model')}
                    disabled
                    title={t('Model selected by the Matrix list. Open Matrix to change it.')}
                  >
                    <option>{info?.model || t('Task model')}</option>
                  </select>
                  <button aria-label={t('Matrix model settings')} onClick={onSettings}>
                    ↗
                  </button>
                </div>
              ) : (
                <ChatModelMenu
                  settings={settings}
                  conversationId={conversation?.id}
                  onSettings={onSettings}
                  onError={onError}
                />
              )}
              <button
                className="attach-image"
                aria-label={t('Attach image')}
                disabled={responding || images.length >= 4 || settings.visionEnabled === false}
                onClick={() =>
                  void api
                    .image('vision')
                    .then((url) => {
                      if (url) setImages((old) => (old.length < 4 ? [...old, url] : old));
                    })
                    .catch((e) => onError(e.message))
                }
              >
                <span className="image-symbol" aria-hidden="true">
                  <span />
                </span>
              </button>
              <button
                aria-label={t('Show thinking')}
                aria-pressed={settings.showThinking ?? false}
                data-tooltip={t('Show or hide reasoning returned by your selected model.')}
                className={settings.showThinking ? 'selected' : ''}
                onClick={() =>
                  void api
                    .settings({ showThinking: !settings.showThinking })
                    .catch((e) => onError(e.message))
                }
              >
                <Icon name="lightbulb" />
              </button>
              <button
                aria-label={t('Automatically read replies aloud')}
                aria-pressed={settings.autoReadAloud ?? false}
                data-tooltip={t(
                  settings.optionalModules?.tts?.enabled
                    ? 'Read each completed agent reply aloud. Enable or disable automatic reading.'
                    : 'Enable a voice in Settings → Optional Modules first.',
                )}
                className={settings.autoReadAloud ? 'selected' : ''}
                disabled={!settings.optionalModules?.tts?.enabled}
                onClick={() => {
                  if (settings.autoReadAloud) stopPlayback();
                  void api
                    .settings({ autoReadAloud: !settings.autoReadAloud })
                    .catch((e) => onError(e.message));
                }}
              >
                <Icon name="volume-2" />
              </button>
              {settings.optionalModules?.stt?.enabled ? (
                <button
                  type="button"
                  className={'dictate-button' + (dictating ? ' selected' : '')}
                  aria-label={t(dictating ? 'Stop listening' : 'Dictate')}
                  data-tooltip={t(dictating ? 'Stop listening' : 'Dictate')}
                  aria-pressed={dictating}
                  onClick={() => {
                    if (dictating) {
                      void stopMic.current?.();
                      setDictating(false);
                      setPartialSpeech('');
                    } else
                      void dictate(
                        (text, final) => {
                          if (final) {
                            setDraft((old) => old + (old ? ' ' : '') + text);
                            setPartialSpeech('');
                          } else setPartialSpeech(text);
                        },
                        onError,
                        () => {
                          setDictating(false);
                          setPartialSpeech('');
                        },
                      )
                        .then((stop) => {
                          if (!mounted.current) {
                            void stop(false);
                            return;
                          }
                          stopMic.current = stop;
                          setDictating(true);
                        })
                        .catch(onError);
                  }}
                >
                  <Icon name="microphone" />
                </button>
              ) : null}
              <select
                className="composer-select approval-select"
                aria-label={t('Command approvals')}
                title={t('Command approvals')}
                value={settings.approvalMode ?? 'ask'}
                onChange={(e) =>
                  void api
                    .settings({ approvalMode: e.target.value as Settings['approvalMode'] })
                    .catch((e) => onError(e.message))
                }
              >
                {approvalChoices.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </div>
            {partialSpeech ? (
              <small className="dictation-preview" role="status">
                {partialSpeech}
              </small>
            ) : null}
            {canSteer && (
              <button
                className="steer-response"
                aria-label={t('Steer response')}
                disabled={sendingSteer || !draft.trim()}
                onClick={() => void send()}
              >
                {t('Steer')}
              </button>
            )}
            {responding ? (
              <button
                className="send"
                aria-label={t('Stop response')}
                onClick={() => conversation && void api.stop(conversation.id)}
              >
                ■
              </button>
            ) : (
              <button
                className="send"
                aria-label={t('Send message')}
                disabled={!draft.trim() && !images.length}
                onClick={() => void send()}
              >
                ↑
              </button>
            )}
          </div>
        </div>
        <div className="compose-hint">
          {settings.model
            ? ['ollama', 'lmstudio', 'llamacpp'].includes(settings.provider)
              ? t('On your machine. In your hands.')
              : t(
                  'The selected API provider receives your conversation, shared context and attached images.',
                )
            : t('Choose a model in Settings.')}
          <span>{t(canSteer ? 'Enter to steer' : 'Enter to send')}</span>
        </div>
      </div>
    </div>
  );
}
