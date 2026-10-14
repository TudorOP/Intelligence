import { t } from './i18n';
const guides: Record<string, { steps: string[]; url: string }> = {
  ollama: {
    steps: [
      'Install and start Ollama, then download a model.',
      'Use the server address below. On this computer, the usual address is http://127.0.0.1:11434.',
      'Test the connection, then choose a downloaded model.',
    ],
    url: 'https://docs.ollama.com/quickstart',
  },
  lmstudio: {
    steps: [
      'Download a model in LM Studio.',
      'Open Developer and start the server. Copy the address shown there.',
      'The usual address on this computer is http://127.0.0.1:1234. Test it below, then choose a model.',
    ],
    url: 'https://lmstudio.ai/docs/developer/core/server',
  },
  llamacpp: {
    steps: [
      'Start your llama.cpp server with a downloaded model.',
      'Use the server address supplied by whoever configured it, including /v1.',
      'Test the connection, then choose the model.',
    ],
    url: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server',
  },
  openai: {
    steps: [
      'Open the official API dashboard and create an API key.',
      'Check API billing and usage limits. A chat subscription does not automatically configure API access.',
      'Paste the key into the protected field, save it, test the connection and choose a model.',
    ],
    url: 'https://platform.openai.com/api-keys',
  },
  openrouter: {
    steps: [
      'Open your OpenRouter account and create an API key.',
      'Check your account credits and model pricing.',
      'Paste the key into the protected field, save it, test the connection and choose a model.',
    ],
    url: 'https://openrouter.ai/settings/keys',
  },
  mistral: {
    steps: [
      'Open Mistral Studio and choose API Keys.',
      'Create a key and check your account limits and billing.',
      'Paste the key into the protected field, save it, test the connection and choose a model.',
    ],
    url: 'https://console.mistral.ai/',
  },
  qwen: {
    steps: [
      'Open Alibaba Cloud Model Studio and choose your region and workspace.',
      'Create an API key and copy its matching service endpoint. Keys and endpoints must use the same region and billing plan.',
      'Paste the address and key below, save the key, test the connection and choose a model.',
    ],
    url: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key',
  },
  compatible: {
    steps: [
      'Ask the service or server owner for its API base address and model ID.',
      'Use a protected key if required. Online services require HTTPS.',
      'Test the connection and choose a model, or enter the supplied model ID.',
    ],
    url: 'https://developers.openai.com/api/docs',
  },
};
export default function ProviderHelp({ provider }: { provider: string }) {
  const guide = guides[provider];
  return guide ? (
    <div className="provider-help">
      <ol>
        {guide.steps.map((step) => (
          <li key={step}>{t(step)}</li>
        ))}
      </ol>
      <a href={guide.url} target="_blank" rel="noopener noreferrer">
        {t('Official setup guide')} ↗
      </a>
      <small>
        {t('Opens your browser. Account setup and downloads happen outside Intelligence.')}
      </small>
    </div>
  ) : null;
}
