import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import Switch from './Switch';
import { speak, stopPlayback, dictate } from './speech';
export default function OptionalModulesPanel({ onError }: { onError: (error: any) => void }) {
  const [status, setStatus] = useState<any>(null),
    [busy, setBusy] = useState(''),
    [keys, setKeys] = useState<Record<string, string>>({}),
    [sample, setSample] = useState('Hello. Your speech module is ready.'),
    [transcript, setTranscript] = useState(''),
    [listening, setListening] = useState(false),
    [archives, setArchives] = useState<string[]>([]),
    [archive, setArchive] = useState(''),
    [notice, setNotice] = useState('');
  const [speechState, setSpeechState] = useState('');
  const stopMic = useRef<((finish?: boolean) => Promise<void>) | null>(null),
    finalTranscript = useRef(''),
    mounted = useRef(false);
  const refresh = () => api.workspace({ action: 'module-status' }).then(setStatus).catch(onError);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void api
      .workspace({ action: 'module-status' })
      .then((v) => {
        if (alive) setStatus(v);
      })
      .catch(onError);
    const unlisten = api.onEvent((event: any) => {
      if (!alive) return;
      if (event.type !== 'module-status') return;
      setStatus((old: any) =>
        old
          ? {
              ...old,
              modules: old.modules.map((m: any) =>
                m.id === event.module && (!event.engineId || m.engineId === event.engineId)
                  ? { ...m, state: event }
                  : m,
              ),
            }
          : old,
      );
      if (
        ['installed', 'model-ready', 'not-installed', 'error', 'cancelled'].includes(event.status)
      )
        void refresh();
    });
    return () => {
      mounted.current = false;
      alive = false;
      unlisten();
      void stopMic.current?.(false);
      stopPlayback();
    };
  }, []);
  const act = async (id: string, action: string, input: any = {}) => {
    setBusy(id);
    setNotice('');
    try {
      const result = await api.workspace({ action: 'module-' + action, id, ...input });
      if (result?.modules) setStatus(result);
      return result;
    } catch (e) {
      onError(e);
    } finally {
      setBusy('');
    }
  };
  const configure = (id: string, configuration: any) =>
    void act(id, 'configure', { configuration });
  const startMic = async () => {
    try {
      setTranscript('');
      finalTranscript.current = '';
      stopMic.current = await dictate(
        (text, final) => {
          if (final) {
            finalTranscript.current += (finalTranscript.current ? ' ' : '') + text;
            setTranscript(finalTranscript.current);
          } else
            setTranscript(finalTranscript.current + (finalTranscript.current ? ' ' : '') + text);
        },
        onError,
        () => setListening(false),
      );
      if (!mounted.current) {
        await stopMic.current(false);
        return;
      }
      setListening(true);
    } catch (e) {
      onError(e);
    }
  };
  return (
    <section className="settings-section optional-modules">
      <span className="eyebrow">{t('YOUR CHOICE')}</span>
      <h2>{t('Optional Modules')}</h2>
      <p>
        {t(
          'Install only what you need. Engines, models and voices download into app data; they are not included in the AppImage.',
        )}
      </p>
      {status && !status.supported ? (
        <p className="settings-note">
          {t(
            'Local engine installation requires Linux x64. Compatible audio APIs remain available.',
          )}
        </p>
      ) : null}
      {!status ? (
        <p role="status">{t('Loading…')}</p>
      ) : (
        <div className="optional-module-grid">
          {status.modules.map((module: any) => {
            const c = module.configuration || {},
              remote = c.adapter === 'compatible',
              working = [
                'preparing',
                'downloading-runtime',
                'downloading-engine',
                'verifying-runtime',
                'installing',
                'downloading-model',
                'building-links',
                'uninstalling',
              ].includes(module.state.status);
            const stateLabel: Record<string, string> = {
              preparing: 'Preparing',
              'downloading-runtime': 'Downloading runtime',
              'downloading-engine': 'Downloading engine',
              'verifying-runtime': 'Verifying runtime',
              installing: 'Installing',
              uninstalling: 'Uninstalling',
              'downloading-model': 'Downloading model / voice',
              'building-links': 'Building link index',
              installed: 'Installed',
              'not-installed': 'Not installed',
              'model-ready': 'Model ready',
              error: 'Needs attention',
              cancelled: 'Cancelled',
            };
            return (
              <section className="settings-card optional-module-card" key={module.id}>
                <h3>{t(module.name)}</h3>
                {module.id === 'tts' && !remote ? (
                  <label>
                    {t('Local speech engine')}
                    <select
                      value={c.engine || 'piper'}
                      disabled={working || !!busy}
                      onChange={(e) => {
                        stopPlayback();
                        configure('tts', { engine: e.target.value });
                      }}
                    >
                      <option value="kokoro">Kokoro-82M</option>
                      <option value="piper">Piper</option>
                    </select>
                  </label>
                ) : null}
                <small>
                  {module.version} · {module.license}
                </small>
                <p role="status">
                  {t(stateLabel[module.state.status] || module.state.status)}
                  {module.state.total
                    ? ` · ${Math.round((100 * module.state.bytes) / module.state.total)}%`
                    : ''}
                </p>
                {module.state.error ? (
                  <p role="alert" className="inspection-error">
                    {t(module.state.error)}
                  </p>
                ) : null}
                <div className="module-actions">
                  <button
                    disabled={working || !!busy || !status.supported}
                    onClick={() => void act(module.id, module.installed ? 'verify' : 'install')}
                  >
                    {t(module.installed ? 'Verify / update' : 'Install')}
                  </button>
                  {working ? (
                    <button onClick={() => void act(module.id, 'cancel')}>{t('Cancel')}</button>
                  ) : module.installed || module.hasData ? (
                    <button
                      disabled={!!busy}
                      data-tooltip={t(
                        'Removes this engine, its downloaded models and voices, and its download cache.',
                      )}
                      onClick={() => {
                        if (module.id === 'tts') stopPlayback();
                        void act(module.id, 'uninstall');
                      }}
                    >
                      {t('Uninstall')}
                    </button>
                  ) : null}
                </div>
                {module.id === 'tts'
                  ? module.engines
                      ?.filter((engine: any) => engine.id !== module.engineId && engine.hasData)
                      .map((engine: any) => (
                        <button
                          key={engine.id}
                          disabled={working || !!busy}
                          data-tooltip={t(
                            'Removes this engine, its downloaded models and voices, and its download cache.',
                          )}
                          onClick={() => void act('tts', 'uninstall', { engineId: engine.id })}
                        >
                          {t('Uninstall')} {engine.name}
                        </button>
                      ))
                  : null}
                <label className="setting-switch">
                  <span>{t('Enable module')}</span>
                  <Switch
                    checked={module.enabled}
                    onChange={(e) => configure(module.id, { enabled: e.target.checked })}
                  />
                </label>
                {module.id !== 'zim' ? (
                  <>
                    <label>
                      {t('Connection')}
                      <select
                        aria-label={t('Connection') + ' ' + module.id}
                        value={c.adapter || 'local'}
                        onChange={(e) => configure(module.id, { adapter: e.target.value })}
                      >
                        <option value="local">{t('Local engine')}</option>
                        <option value="compatible">{t('Compatible audio API')}</option>
                      </select>
                    </label>
                    {remote ? (
                      <>
                        <label>
                          {t('API address')}
                          <input
                            type="url"
                            aria-label={t('API address') + ' ' + module.id}
                            defaultValue={c.endpoint || ''}
                            key={module.id + '-' + remote}
                            placeholder="https://example.com/v1"
                            onBlur={(e) =>
                              configure(module.id, { endpoint: e.target.value.trim() })
                            }
                          />
                        </label>
                        <label>
                          {t('Model ID')}
                          <input
                            defaultValue={c.model || ''}
                            onBlur={(e) => configure(module.id, { model: e.target.value.trim() })}
                          />
                        </label>
                        {module.id === 'tts' ? (
                          <label>
                            {t('Voice')}
                            <input
                              defaultValue={c.voice || 'alloy'}
                              onBlur={(e) => configure(module.id, { voice: e.target.value.trim() })}
                            />
                          </label>
                        ) : (
                          <small>
                            {t(
                              'This API returns a transcript after you stop recording. The local engine streams live text.',
                            )}
                          </small>
                        )}
                        <label>
                          {t('API key')}
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={keys[module.id] || ''}
                            onChange={(e) =>
                              setKeys((v) => ({ ...v, [module.id]: e.target.value }))
                            }
                          />
                        </label>
                        <div className="module-actions">
                          <button
                            disabled={!keys[module.id]?.trim() || !!busy}
                            onClick={() =>
                              void act(module.id, 'key', { key: keys[module.id] }).then(
                                (result) => {
                                  if (result) setKeys((v) => ({ ...v, [module.id]: '' }));
                                },
                              )
                            }
                          >
                            {t('Save key')}
                          </button>
                          <button
                            disabled={!module.credential?.configured}
                            onClick={() => void act(module.id, 'forget-key')}
                          >
                            {t('Forget key')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {module.id === 'stt' ? (
                          <label>
                            {t('English dictation model')}
                            <select
                              value={c.recognitionModel || 'fast'}
                              disabled={working || !!busy}
                              onChange={(e) =>
                                configure('stt', { recognitionModel: e.target.value })
                              }
                            >
                              <option value="larger">{t('Larger · Recommended')}</option>
                              <option value="fast">{t('Lightweight · 20M')}</option>
                            </select>
                            <small>
                              {t(
                                'The larger English model uses more memory and CPU. Both models provide live dictation.',
                              )}
                            </small>
                          </label>
                        ) : null}
                        {module.id === 'tts' && module.engineId === 'kokoro' ? (
                          <label>
                            {t('Voice · English only')}
                            <select
                              value={c.localVoice || 'af_heart'}
                              disabled={working || !!busy}
                              onChange={(e) => {
                                stopPlayback();
                                configure('tts', { localVoice: e.target.value });
                              }}
                            >
                              <option value="af_heart">
                                {t('Heart · Female · American English')}
                              </option>
                              <option value="af_bella">
                                {t('Bella · Female · American English')}
                              </option>
                              <option value="am_michael">
                                {t('Michael · Male · American English')}
                              </option>
                            </select>
                          </label>
                        ) : null}
                        <p>
                          {t(module.model.name)} · {module.model.language}
                        </p>
                        <small>
                          {module.model.license} · {Math.ceil(module.model.bytes / 1024 ** 2)} MiB
                        </small>
                        <small role="status">
                          {t(module.modelReady ? 'Model ready' : 'Model download required')}
                        </small>
                        <button
                          disabled={working || !!busy || !status.supported}
                          onClick={() => void act(module.id, 'download-model')}
                        >
                          {t(
                            module.modelReady ? 'Repair model download' : 'Download model / voice',
                          )}
                        </button>
                        <small>
                          {t(
                            module.id === 'tts'
                              ? 'Local speech is English-only. Model and voice files download separately.'
                              : 'Model and voice files download separately. Other providers may support additional languages.',
                          )}
                        </small>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <label>
                      {t('ZIM directory')}
                      <input aria-label={t('ZIM directory')} readOnly value={c.directory || ''} />
                      <button
                        onClick={() =>
                          void api
                            .directory()
                            .then((directory) => directory && configure('zim', { directory }))
                            .catch(onError)
                        }
                      >
                        {t('Choose directory')}
                      </button>
                    </label>
                    <button
                      disabled={!module.enabled || !module.installed || !!busy}
                      onClick={() =>
                        void act('zim', 'zim', { request: { action: 'archives' } }).then(
                          (result) => {
                            if (result) {
                              setArchives(result.archives);
                              setArchive(result.archives[0] || '');
                              setNotice(t('Archives found') + ': ' + result.total);
                            }
                          },
                        )
                      }
                    >
                      {t('Test archive access')}
                    </button>
                    {archives.length ? (
                      <>
                        <select
                          aria-label={t('Archive')}
                          value={archive}
                          onChange={(e) => setArchive(e.target.value)}
                        >
                          {archives.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                        <button
                          disabled={working || !archive}
                          onClick={() => void act('zim', 'build-links', { archive })}
                        >
                          {t('Build inbound link index')}
                        </button>
                        <small>
                          {t(
                            'Inbound links require an index. Large archives can take time; Cancel stops the operation.',
                          )}
                        </small>
                      </>
                    ) : null}
                  </>
                )}
                <details className="module-license">
                  <summary>{t('License & source')}</summary>
                  <p>{module.license}</p>
                  <a
                    href={module.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (window.intelligence) {
                        e.preventDefault();
                        void act(module.id, 'source');
                      }
                    }}
                  >
                    {t('Open upstream source')}
                  </a>
                  <p>
                    {t(
                      'Downloaded packages retain their license notices. Model and archive content have separate terms.',
                    )}
                  </p>
                </details>
              </section>
            );
          })}
        </div>
      )}
      {status ? (
        <details
          className="settings-card speech-test"
          onToggle={(e) => {
            if (!e.currentTarget.open) {
              void stopMic.current?.(false);
              setListening(false);
              stopPlayback();
            }
          }}
        >
          <summary>{t('Try speech')}</summary>
          <div className="speech-test-body">
            <label>
              {t('Sample text')}
              <textarea
                rows={2}
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                maxLength={12000}
              />
            </label>
            <div className="module-actions">
              <button
                disabled={!status.modules.find((m: any) => m.id === 'tts')?.enabled}
                onClick={() =>
                  void speak(
                    sample,
                    (e) => onError(e?.message || String(e)),
                    (state) => setSpeechState(t(state)),
                  ).catch((e) => onError(e?.message || String(e)))
                }
              >
                {t('Test voice')}
              </button>
              <button onClick={stopPlayback}>{t('Stop audio')}</button>
              <button
                disabled={!status.modules.find((m: any) => m.id === 'stt')?.enabled}
                onClick={() => {
                  if (listening) {
                    void stopMic.current?.();
                    setListening(false);
                  } else void startMic();
                }}
              >
                {t(listening ? 'Stop listening' : 'Test microphone')}
              </button>
            </div>
            {speechState ? <p role="status">{speechState}</p> : null}
            {transcript ? <p role="status">{transcript}</p> : null}
          </div>
        </details>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
