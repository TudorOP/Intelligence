import { inferenceProviders } from '../electron/inference-catalog.mjs';
export const providers = inferenceProviders;
export const providerNames: Record<string, string> = Object.fromEntries(
  providers.map((p) => [p.id, p.name]),
);
export const providerDefaults: Record<string, string> = Object.fromEntries(
  providers.map((p) => [p.id, p.endpoint]),
);
