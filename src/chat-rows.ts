import type { Message } from './types';

export type ChatRow =
  { kind: 'message'; message: Message } | { kind: 'tools'; messages: Message[] };

// Keep transport history intact; combine only uninterrupted activity in the view.
export function chatRows(messages: Message[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let activity: Message[] = [];
  const flush = () => {
    if (activity.some((m) => m.data.tool && !m.data.modelOnly))
      rows.push({ kind: 'tools', messages: activity });
    else rows.push(...activity.map((message): ChatRow => ({ kind: 'message', message })));
    activity = [];
  };
  for (const message of messages) {
    if (message.data.tool || message.data.modelOnly) activity.push(message);
    else {
      flush();
      rows.push({ kind: 'message', message });
    }
  }
  flush();
  return rows;
}

export function toolFailed(message: Message): boolean {
  if (message.data.toolStatus) return message.data.toolStatus === 'error';
  try {
    const result = JSON.parse(
      message.data.modelMessage?.content ?? message.content.slice(message.content.indexOf(':') + 1),
    );
    return !!(result?.error || result?.isError);
  } catch {
    return false;
  }
}
