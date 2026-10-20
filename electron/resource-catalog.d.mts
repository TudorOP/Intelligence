export const resourceKinds: Set<string>;
export function resourceLabel(kind: string): string;
export function conversationSources(
  conversation: { id: string; data: any },
  messages: { data: any }[],
): string[];
export function resourceGroup(item: { kind: string }): string;
export function resourceGate(item: { kind: string }): string | null;
