import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { providerInfo, providerBase, requireConnectedProvider } from './inference-providers.mjs';
import { residentModel } from './model-residency.mjs';

export async function listModels(settings, runtime = {}) {
  requireConnectedProvider(settings);
  const info = providerInfo(settings.provider),
    root = providerBase(settings);
  const key = runtime.key ?? '';
  if (info.cloud && !info.optionalKey && !key) throw new Error('Save an API key for ' + info.name + ' in Settings');
  const url =
    settings.provider === 'ollama'
      ? root + '/api/tags'
      : info.cloud
        ? root + '/models'
        : root.replace(/\/v1$/, '') + '/v1/models';
  let response;
  try {
    response = await (runtime.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      headers: key ? { Authorization: 'Bearer ' + key } : {},
    });
  } catch {
    throw new Error(`Cannot reach ${info.name}. Check the server address and connection.`);
  }
  if (!response.ok) throw new Error(`Model server returned HTTP ${response.status}`);
  const value = await response.json();
  return settings.provider === 'ollama'
    ? (value.models ?? []).map((m) => m.name)
    : (value.data ?? []).map((m) => m.id);
}
export async function completion(settings, messages, tools, onDelta, signal, runtime = {}) {
  requireConnectedProvider(settings);
  const started = performance.now();
  let firstToken = null,
    usage = null;
  messages = messages.map(({ metrics, ...message }) => message);
  if (!settings.model) throw new Error('Choose a model in Settings → Model & providers first.');
  if (settings.matrixLoadedOnly) {
    const resident = await residentModel(settings, signal, runtime);
    if (!resident)
      throw Error(
        'The selected chat model is no longer loaded. Matrix preloading is disabled; load it in your inference engine and retry.',
      );
    settings = { ...settings, model: resident };
  }
  const ollama = settings.provider === 'ollama';
  const info = providerInfo(settings.provider),
    root = providerBase(settings),
    key = runtime.key ?? '';
  if (info.cloud && !info.optionalKey && !key) throw new Error('Save an API key for ' + info.name + ' in Settings');
  if (
    settings.visionEnabled === false &&
    messages.some(
      (m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'),
    )
  )
    throw new Error(
      'Image input is disabled for this model. Enable vision in Settings or choose a vision-capable model.',
    );
  const wireMessages = ollama
    ? messages.map((m) =>
        Array.isArray(m.content)
          ? {
              ...m,
              content: m.content
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('\n'),
              images: m.content
                .filter((part) => part.type === 'image_url')
                .map((part) => part.image_url.url.split(',')[1]),
            }
          : m.tool_calls
            ? {
                ...m,
                tool_calls: m.tool_calls.map((c) => ({
                  ...c,
                  function: {
                    ...c.function,
                    arguments:
                      typeof c.function.arguments === 'string'
                        ? (() => {
                            try {
                              return JSON.parse(c.function.arguments || '{}');
                            } catch {
                              return {};
                            }
                          })()
                        : c.function.arguments,
                  },
                })),
              }
            : m,
      )
    : info.cloud
      ? messages.map((m) => ({
          role: m.role,
          content:
            settings.provider === 'mistral' && Array.isArray(m.content)
              ? m.content.map((part) =>
                  part.type === 'image_url'
                    ? { type: 'image_url', image_url: part.image_url.url }
                    : part,
                )
              : (m.content ?? ''),
          ...(m.tool_calls
            ? {
                tool_calls: m.tool_calls.map((c) => ({
                  ...c,
                  id:
                    settings.provider === 'mistral'
                      ? createHash('sha256').update(c.id).digest('hex').slice(0, 9)
                      : c.id,
                })),
              }
            : {}),
          ...(m.tool_call_id
            ? {
                tool_call_id:
                  settings.provider === 'mistral'
                    ? createHash('sha256').update(m.tool_call_id).digest('hex').slice(0, 9)
                    : m.tool_call_id,
              }
            : {}),
          ...(settings.provider === 'openrouter' && m.reasoning_details
            ? { reasoning_details: m.reasoning_details }
            : {}),
        }))
      : messages;
  const body = {
    model: settings.model,
    messages: wireMessages,
    stream: true,
    ...(settings.matrixExecution && ollama ? { keep_alive: '15m' } : {}),
    ...(settings.matrixExecution && settings.provider === 'lmstudio' ? { ttl: 900 } : {}),
    ...(!ollama && !['mistral','compatible'].includes(settings.provider)
      ? { stream_options: { include_usage: true } }
      : {}),
    ...(tools.length ? { tools } : {}),
    ...(ollama
      ? { options: { temperature: 0.55 } }
      : !info.cloud
        ? { temperature: 0.55 }
        : settings.provider === 'openai'
          ? { max_completion_tokens: settings.apiMaxTokens ?? 8192 }
          : { max_tokens: settings.apiMaxTokens ?? 8192 }),
  };
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
    throw new Error('This request exceeds 32 MB. Reduce images or start a new conversation.');
  const response = await (runtime.fetch ?? fetch)(
    ollama
      ? root + '/api/chat'
      : info.cloud
        ? root + '/chat/completions'
        : root.replace(/\/v1$/, '') + '/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: 'Bearer ' + key } : {}),
      },
      body: serialized,
      signal: AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(600000),
      ]),
      redirect: 'error',
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `${info.name} request failed (HTTP ${response.status}). ${response.status === 401 ? 'Check the API key.' : response.status === 429 ? 'Check the provider usage limit and billing.' : response.status === 400 ? 'Check the model, image support and request options.' : ''}`,
    );
  }
  if (!response.body) throw new Error('The model returned an empty response');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    content = '',
    reasoning = '',
    reasoningDetails = [],
    calls = [];
  function process(line) {
    if (!line.trim() || line.startsWith(':')) return;
    if (!ollama) {
      if (!line.startsWith('data:')) return;
      line = line.slice(5).trim();
      if (line === '[DONE]') return;
    }
    const chunk = JSON.parse(line);
    if (chunk.usage) usage = chunk.usage;
    if (ollama && chunk.done)
      usage = {
        prompt_tokens: chunk.prompt_eval_count,
        completion_tokens: chunk.eval_count,
        eval_duration: chunk.eval_duration,
      };
    if (chunk.error)
      throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message);
    const delta = ollama ? chunk.message : chunk.choices?.[0]?.delta;
    const thinking =
      (ollama ? delta?.thinking : (delta?.reasoning_content ?? delta?.reasoning)) ?? '';
    reasoning += thinking;
    if (thinking) runtime.onThinking?.(thinking);
    if (settings.provider === 'openrouter')
      for (const detail of delta?.reasoning_details ?? []) {
        const i = detail.index ?? reasoningDetails.length;
        if (!Number.isInteger(i) || i < 0 || i > 127)
          throw new Error('Reasoning detail limit exceeded');
        reasoningDetails[i] = { ...reasoningDetails[i], ...detail };
        if (JSON.stringify(reasoningDetails).length > 4 * 1024 * 1024)
          throw new Error('Reasoning detail limit exceeded');
      }
    if (delta?.content) {
      const text = Array.isArray(delta.content)
        ? delta.content.map((part) => part.text ?? '').join('')
        : delta.content;
      content += text;
      firstToken ??= performance.now();
      if (content.length + reasoning.length > 4 * 1024 * 1024)
        throw new Error('Model response exceeded the streaming limit');
      onDelta(text);
    }
    for (const call of delta?.tool_calls ?? []) {
      if ((ollama && calls.length >= 32) || (call.index ?? 0) >= 32)
        throw new Error('A response supports at most 32 tool calls');
      if (ollama)
        calls.push({
          id: call.id ?? 'call_' + randomUUID(),
          type: 'function',
          function: {
            name: call.function?.name ?? '',
            arguments:
              typeof call.function?.arguments === 'string'
                ? call.function.arguments
                : JSON.stringify(call.function?.arguments ?? {}),
          },
        });
      else {
        const i = call.index ?? 0;
        calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (call.id) calls[i].id = call.id;
        if (call.function?.name) calls[i].function.name += call.function.name;
        if (call.function?.arguments) calls[i].function.arguments += call.function.arguments;
      }
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 2 * 1024 * 1024 || content.length + reasoning.length > 4 * 1024 * 1024)
        throw new Error('Model response exceeded the streaming limit');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) process(line.replace(/\r$/, ''));
    }
    buffer += decoder.decode();
    if (buffer.trim()) process(buffer.trim());
    const ids = new Set();
    for (const call of calls.filter(Boolean)) {
      if (!call.id || ids.has(call.id)) call.id = 'call_' + randomUUID();
      ids.add(call.id);
    }
    return {
      role: 'assistant',
      content,
      metrics: {
        promptTokens: usage?.prompt_tokens ?? null,
        outputTokens:
          usage?.completion_tokens ?? Math.ceil((content.length + reasoning.length) / 3),
        estimated: !Number.isFinite(usage?.completion_tokens),
        seconds:
          usage?.eval_duration > 0
            ? usage.eval_duration / 1e9
            : Math.max(0.001, (performance.now() - started) / 1000),
        speedBasis:
          usage?.eval_duration > 0
            ? 'provider generation timing'
            : 'request elapsed; includes prompt processing',
        timeToFirstToken: firstToken === null ? null : (firstToken - started) / 1000,
      },
      ...(reasoning ? (ollama ? { thinking: reasoning } : { reasoning_content: reasoning }) : {}),
      ...(calls.filter(Boolean).length ? { tool_calls: calls.filter(Boolean) } : {}),
      ...(reasoningDetails.filter(Boolean).length
        ? { reasoning_details: reasoningDetails.filter(Boolean) }
        : {}),
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
