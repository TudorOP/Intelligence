export type ProviderId = 'ollama' | 'lmstudio' | 'llamacpp' | 'openai' | 'mistral' | 'qwen' | 'openrouter' | 'compatible';
export const inferenceProviders: { id: ProviderId; name: string; endpoint: string; cloud: boolean; optionalKey?: boolean }[];
