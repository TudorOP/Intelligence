import { providerBase, providerInfo } from './inference-providers.mjs';

async function json(settings, route, body, signal, runtime = {}, timeout = 8000) {
  const root =
    settings.provider === 'lmstudio'
      ? providerBase(settings).replace(/\/v1$/, '')
      : providerBase(settings);
  const response = await (runtime.fetch ?? fetch)(root + route, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeout)]),
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(runtime.key ? { Authorization: 'Bearer ' + runtime.key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const error = Error(
      `${providerInfo(settings.provider).name} model availability returned HTTP ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function residentModel(settings, signal, runtime = {}) {
  if (providerInfo(settings.provider).cloud) return settings.model;
  if (settings.provider === 'ollama') {
    const value = await json(settings, '/api/ps', null, signal, runtime);
    const found = value.models?.find((m) =>
      [m.name, m.model].some(
        (name) => name === settings.model || name === settings.model + ':latest',
      ),
    );
    // Avoid dispatching a request against a model already about to expire.
    if (found?.expires_at && Date.parse(found.expires_at) - Date.now() < 10000) return null;
    return found?.name ?? found?.model ?? null;
  }
  let value;
  try {
    value = await json(settings, '/api/v1/models', null, signal, runtime);
  } catch (error) {
    if (![404, 405].includes(error.status)) throw error;
    value = await json(settings, '/api/v0/models', null, signal, runtime);
  }
  const models = value.models ?? value.data;
  if (!Array.isArray(models))
    throw Error(
      'LM Studio did not report model residency. Update LM Studio to use loaded-only Matrix execution.',
    );
  const found = models.find((m) =>
    [m.key, m.id, ...(m.loaded_instances ?? []).map((i) => i.id)].includes(settings.model),
  );
  const instance =
    found?.loaded_instances?.find((i) => i.id === settings.model) ?? found?.loaded_instances?.[0];
  return instance?.id ?? (found?.state === 'loaded' ? found.id : null);
}

export async function prepareModel(settings, signal, runtime = {}) {
  if (!settings.model) throw Error('Choose a model for this Matrix list or in Chat.');
  if (providerInfo(settings.provider).cloud) return settings.model;
  const loaded = await residentModel(settings, signal, runtime);
  if (loaded) return loaded;
  if (settings.provider === 'ollama') {
    // An empty generate request loads an installed model without generating text.
    await json(
      settings,
      '/api/generate',
      { model: settings.model, stream: false, keep_alive: '15m' },
      signal,
      runtime,
      120000,
    );
  } else {
    // Use JIT loading with a documented TTL. Explicit /models/load has no documented TTL.
    // One output token bounds the warm-up; no helper LLM is used for scheduling.
    await json(
      settings,
      '/v1/chat/completions',
      {
        model: settings.model,
        messages: [{ role: 'user', content: '' }],
        max_tokens: 1,
        stream: false,
        ttl: 900,
      },
      signal,
      runtime,
      120000,
    );
  }
  signal?.throwIfAborted();
  const ready = await residentModel(settings, signal, runtime);
  if (!ready)
    throw Error(
      'The server did not confirm that the Matrix model loaded. Check its model and loading configuration.',
    );
  return ready;
}
