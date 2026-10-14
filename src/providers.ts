export const providers = [
  { id: 'ollama', name: 'Ollama', endpoint: 'http://127.0.0.1:11434', cloud: false },
  { id: 'lmstudio', name: 'LM Studio', endpoint: 'http://127.0.0.1:1234', cloud: false },
  { id: 'llamacpp', name: 'llama.cpp', endpoint: 'http://127.0.0.1:8080/v1', cloud: false },
  { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1', cloud: true },
  { id: 'mistral', name: 'Mistral', endpoint: 'https://api.mistral.ai/v1', cloud: true },
  {
    id: 'qwen',
    name: 'Qwen',
    endpoint: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    cloud: true,
  },
  { id: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', cloud: true },
  {
    id: 'compatible',
    name: 'OpenAI-compatible API',
    endpoint: 'http://127.0.0.1:8080/v1',
    cloud: true,
  },
] as const;
export const providerNames: Record<string, string> = Object.fromEntries(
  providers.map((p) => [p.id, p.name]),
);
export const providerDefaults: Record<string, string> = Object.fromEntries(
  providers.map((p) => [p.id, p.endpoint]),
);
