import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t, useLanguage, sourceText } from './i18n';
const help: Record<string, string> = {
  'Choose context':
    'Choose resource names for this chat. Their content is shared only when this agent has effective access.',
  Revoke:
    'Remove this agent’s grant without deleting the resource or its contents. Global and profile restrictions still apply.',
  'Still artwork': 'Choose a still background independently of the theme and automatic AI work.',
  'Artwork strength': 'Adjust how visible the still background is behind your workspace.',
  'Background blur':
    'Soften the still background. Zero keeps it sharp; this does not affect AI work.',
  'New report':
    'Choose a saved template or a starting point, create a reusable template, or request a one-off custom report.',
  'New custom report': 'Create a report once without saving a template or enabling a schedule.',
  'Assistant context scope':
    'Prioritize the current screen while keeping access to all permitted work. Focus does not change permissions.',
  'Create template': 'Save reusable report sections, sources and optional scheduling preferences.',
  'When ready':
    'Choose whether a finished report is saved quietly, sends a notification or opens for reading.',
  'Share my name with agents':
    'Include your chosen name in conversations sent to the selected model provider. Turn off to stop including it in new requests.',
  'Your name':
    'Choose how agents address you. Sharing it is optional and controlled by the switch below.',
  'Event port':
    'The connection number for another program on this computer to signal a task. Keep 30091 unless it is already in use; save once you finish editing.',
  'Save event port':
    'Save the connection number and update the local event address. Update the other program to use the same address.',
  'Local external events':
    'Allow a program on this computer to send a signal to a Matrix task. Leave off unless you have set up that connection.',
  'Reveal event token':
    'Show the private connection password needed by the other program. Use it in its Authorization header.',
  'Event token':
    'The private connection password for local event signals. Keep it private and use it only in the program you connect.',
  'Wake laptop for tasks':
    'Ask supported Linux hardware to wake for scheduled work while Intelligence stays open. Requires wake permissions configured on Linux.',
  'Automatic reports':
    'Allow enabled report schedules to run at their chosen times while Intelligence is open and background AI is running. Off pauses schedules; Run now remains available.',
  'Desktop activity notifications':
    'Show desktop notifications when work finishes or needs your attention. Saved results remain available in Activity.',
  'Missed task occurrences':
    'Choose what happens when a scheduled task is over an hour late: ask you, skip that occurrence, or run when available. Interrupted work still needs review.',
  'Notebook access':
    'Allow agents to use notebooks you have shared. Off suspends access without clearing your individual choices.',
  'Vault access':
    'Allow agents to use Vault files you have shared. Off suspends access without clearing your individual choices.',
  'Task board access':
    'Allow agents to use task boards you have shared. Assigning an agent to run tasks is a separate choice.',
  'Calendar access':
    'Allow agents to read or edit calendars you have shared, according to each calendar’s permissions.',
  'Reports access':
    'Allow agents to use reports and templates you have shared. This does not turn on automatic reports.',
  'Memory recall':
    'Allow relevant saved memories to be retrieved for conversations. Off keeps saved memories but stops agent recall.',
  'Keep running in the tray':
    'Keep Intelligence open in the background after closing its window, so scheduled work can continue. Quitting stops work.',
  'Repair tool-call formatting':
    'Help the model correct malformed requests to app tools. Permissions and approval choices still apply.',
  'Tool correction attempts':
    'Limit how many extra attempts the model gets to correct an invalid tool request in one response.',
  'Prepare model before task (minutes)':
    'Choose how many minutes before scheduled work Intelligence starts preparing the task model.',
  'Task time budget (minutes)':
    'Limit how long a Matrix task can work before it stops and records its progress.',
  'Maximum tool steps per task':
    'Limit the number of tool actions in a Matrix task, such as reading a note or searching.',
  'Queue order':
    'Choose which Matrix list gets priority when several tasks are ready at the same time.',
  'Agent access to Matrix items':
    'Allow agents to use Matrix tasks you have shared. List integration separately controls automatic execution.',
  'Show completed tasks':
    'Keep completed Matrix tasks visible. Off hides them without deleting them.',
  'Compact task rows': 'Use smaller Matrix task rows so more tasks fit on screen.',
  'Include downloaded model caches':
    'Include downloaded memory models in the backup to avoid downloading them again. This makes the backup larger.',
  'Create complete backup':
    'Choose a folder and save a copy of your app work and settings. Credentials and external project files are excluded.',
  'Preview a backup':
    'Choose an existing backup and inspect its contents before deciding whether to restore it.',
  'Restore verified backup':
    'Replace current app work with the previewed backup. Intelligence first saves a recovery copy and pauses automatic work.',
  'Getting started': 'Open the optional guide to naming, models, memory downloads and appearance.',
  'Prepare memory now':
    'Download missing memory search files and prepare meaning-based search on this computer. Keyword search remains available.',
  'Enable web search':
    'Let agents search the web through your configured search provider when they need research.',
  'Search provider':
    'Choose the service agents use for web research. Set its address or key below.',
  'SearXNG address':
    'Enter the address of your SearXNG search service, including http:// or https://.',
  'Results per search': 'Choose how many results one web search returns to the agent.',
  'Brave API key': 'Enter the private API key from your Brave Search account, then save it.',
  'Inference API key':
    'Enter the private API key supplied by your chosen model service, then save it.',
  'Test provider': 'Check whether the configured search provider can return results.',
  'Request timeout (seconds)':
    'Choose how long a web search waits for the provider before reporting that it could not respond.',
  'Save key': 'Protect the entered key for your search provider.',
  'Remove key': 'Remove the saved key for your search provider.',
  'Get a key ↗': 'Open the search provider’s account page to obtain an API key.',
  'Subtle background artwork':
    'Show quiet decorative images behind the workspace. Turn off for a plain background.',
  'Reset pane widths': 'Restore the default widths of navigation and assistant panes.',
  'Accent color': 'Choose the highlight color for buttons and selected controls.',
  'App window icon':
    'Choose the icon shown for the running app window. The installed launcher icon is set during packaging.',
  'Tray icon': 'Choose the icon used in your desktop’s tray while Intelligence is running.',
  'In-app logo': 'Choose the logo shown inside Intelligence.',
  'Calendar mode':
    'Show your events, agent work, or both together. Changing this view does not start tasks.',
  'Calendar view': 'Choose a dated list, one week, or a month of calendar entries.',
  'Calendar agent filter': 'Show planned and actual work for one agent, or all agents.',
  'Calendar date': 'Choose the date to display. Use the arrows to move between periods.',
  'Calendar entry actions':
    'View details or open the source. Personal events can also be edited or moved to Trash; execution history is read-only.',
  'Day actions':
    'Add an event on this day or open its agenda. Right-click the day for these commands.',
  'Layers & access': 'Choose which events and work appear, and which calendars agents may use.',
  Configuration: 'Set this Matrix list’s context and task model without cluttering its task queue.',
  'Search settings':
    'Find a setting by its name or a related word, such as backup, theme or model.',
  'Refresh models': 'Ask your configured provider for its available models again.',
  'Model identifier':
    'Enter the exact model name from your provider when it is missing from the list.',
  'Include available images':
    'Allow this report to include images found in permitted sources. This does not generate new images.',
  'Report animations':
    'Animate report section headings. Turn off for an immediate display; system reduced-motion preferences are respected.',
  'Display report images':
    'Show or hide images while reading saved reports. The saved report stays unchanged.',
  Delivery:
    'Choose whether a finished report is saved quietly, sends a notification or opens for reading.',
  'Maximum running minutes':
    'Limit how long report generation may run before stopping and recording its progress.',
  'Maximum tool steps':
    'Limit the number of research or reading actions the report agent may take.',
  'Agent name': 'Choose the name shown for this agent in chats, tasks and reports.',
  'Prepare model before Matrix tasks':
    'Get each list’s model ready before scheduled tasks start. When off, tasks can only use the chat model if it is already loaded.',
  'Personality & preferences':
    'Describe how this agent should write and help you. Required app instructions and permissions always remain active.',
  'Uses global model':
    'Use the model selected in Settings for this agent. Turn off to choose a separate default model for this profile.',
  'Starting date & time':
    'Choose when the event or scheduled work starts, in the timezone selected below.',
  Timezone:
    'Choose the timezone used to interpret the schedule. The same local time may mean a different moment in another timezone.',
  Repeat: 'Choose whether this schedule happens once, repeats regularly, or uses specific dates.',
  'Recurrence interval':
    'Set the number of days, weeks or months between occurrences, according to the repeat option.',
  'Custom report dates':
    'Enter each chosen date and time on a separate line, using the selected timezone.',
  'End date (optional)':
    'Stop repeating after this date. Leave empty to keep the schedule repeating.',
  'Repeated local time':
    'When clocks move back and the same time happens twice, choose which occurrence to use.',
  'Reporting period':
    'Choose which dates the report covers. This is separate from the time when the report is created.',
  'Report agent':
    'Choose the agent and its model that will write this report, using only its permitted sources and tools.',
  Length: 'Choose a short overview, a standard report or a more detailed report.',
  'Section type':
    'Choose what this section covers: calendar, task progress, project work, web research or your own topic.',
  'Additional preferences':
    'Tell the agent how to write the report, such as tone or topics to emphasize. App permissions still apply.',
  'Notebook look': 'Choose the notebook’s shape and binding. Artwork and cover colors are kept.',
  'Agent Profiles':
    'Create, edit, select or remove companions with their own models, personalities and scopes.',
  Intelligence: 'Your rating of the agent’s overall intelligence.',
  Knowledge: 'Your rating of training knowledge and accuracy with that information.',
  'Tool-use': 'Your rating of reliable tool calls and correct tool arguments.',
  'Long Tasks': 'Your rating of staying on track through many steps and tool calls.',
  'Agent Performance':
    'The arithmetic mean of your four ratings. This is your assessment, not a benchmark.',
  'Pause background AI':
    'Pause automatic tasks, preparation and memory processing while retaining foreground chat.',
  'Response context':
    'Inspect recorded context, memory, skills and tools supplied during this response.',
  'Branch from here':
    'Keep the original conversation and continue a separate branch after this answer.',
  'History & restore':
    'Compare saved content and restore it as a new revision, preserving permissions and links.',
  'Relink project folder':
    'Choose this project’s current location; its ID and access preferences are preserved.',
  'Call LLM before Matrix tasks':
    'Prepare each list’s model before scheduled work. Off uses only the already-loaded chat model and reports unavailable execution.',
  'Save trigger':
    'Save the task’s schedule or event condition. Integration and source permissions still control execution.',
  'Model & providers': 'Configure the model service, credentials and available models.',
  'Chat & context': 'Set chat width, follow-latest, thinking, compaction and approvals.',
  'Agent & personality': 'Choose the companion’s name, avatar and assistance style.',
  'Look & feel': 'Choose the interface language, theme, accent and app icons.',
  'Access & automation': 'Control resource access, terminal commands and background task behavior.',
  'Your data': 'Review local storage and open recoverable Trash.',
  'Test connection & find models ↗':
    'Connect to the configured provider and refresh its complete model catalog.',
  'Reset appearance': 'Restore the default theme, accent and icons. Matrix state colors are kept.',
  Search: 'Search the current section using the entered words.',
  'Save API key': 'Protect this credential for the selected provider and server address.',
  'Remove API key': 'Remove the saved credential for this provider and address.',
  'Maximum output tokens':
    'Limit the size of each API response, independently of context capacity.',
  Board: 'Create a new task board.',
  'Add a card':
    'Add a task to this board column; assignment and execution are configured separately.',
  Rename: 'Change this item’s name while keeping its contents and links.',
  'Move…': 'Move this item to another accessible collection.',
  Pause: 'Pause automatic work without deleting the task.',
  'Queue again': 'Return this task to the execution queue for another attempt.',
  'Mark complete': 'Mark this task complete; recurring tasks advance to their next occurrence.',
  'Run now': 'Start this task now using the configured model and current permissions.',
  'Text style': 'Choose a heading level or normal paragraph text.',
  Bold: 'Make selected text bold.',
  Italic: 'Make selected text italic.',
  'Insert table': 'Insert an editable table into this document.',
  'Image width': 'Choose how much horizontal space the document image occupies.',
  'Image layout': 'Choose inline placement or text wrapping for the selected image.',
  Chat: 'Start a conversation or return to your recent chats.',
  Projects: 'Browse project folders and the work linked to them.',
  Notebooks: 'Collect notes in notebooks and optional chapters.',
  Vault: 'Write and organize real Markdown files and folders.',
  Tasks: 'Organize cards on boards and choose which work the agent can run.',
  'Cognition Matrix': 'Manage the three global queues, their tasks, responses and reports.',
  Memory: 'Review saved facts, search past context and manage automatic memory.',
  Skills: 'Create reusable instructions and choose which are available to the agent.',
  Connections: 'Connect external MCP tools and inspect their capabilities.',
  Settings: 'Configure providers, appearance, context and agent permissions.',
  'Choose model': 'Show every available model and select one for your next response.',
  'Show thinking': 'Show or hide reasoning returned by your selected model.',
  'Show model thinking': 'Show or hide reasoning returned by your selected model.',
  'Attach image': 'Attach an image for a vision-capable model. Up to four images per message.',
  'Send message': 'Send your message and attached context. Enter sends; Shift+Enter adds a line.',
  'Stop response': 'Stop the current response or context compaction.',
  'Compact context': 'Summarize older context while keeping original messages and recent turns.',
  'Command approvals':
    'Choose native review, automatic approval for supported safe actions, or Full Access.',
  'Copy message': 'Copy this message text to the clipboard.',
  'More options':
    'Rename, move, link or move this item to recoverable Trash. Right-click the item for the same actions.',
  'Follow the latest message':
    'Keep new messages, thinking and approval requests in view. Turn off to read earlier messages.',
  'Automatic context compaction':
    'Summarize older model input when it reaches your chosen context threshold.',
  'Compact at context usage (%)':
    'Choose the percentage of the model context that triggers automatic summarization.',
  'Context capacity override (tokens)':
    'Use 0 for server detection, or enter the actual loaded context capacity.',
  'Chat width':
    'Choose a comfortable reading column or use a wider canvas for messages and thinking.',
  'Agent access':
    'Choose which app content the agent may read or edit. This does not assign tasks.',
  'Available to agent': 'Include these reusable instructions in the agent’s available skills.',
  'Agent tools': 'Allow structured app tools. The selected model must support function calling.',
  'Image input': 'Allow image attachments only when the selected model supports vision.',
  'Automatic semantic search':
    'Prepare and use the local embedding model for meaning-based recall.',
  'Automatic summaries & facts':
    'Use the local CPU model to summarize idle conversations and extract supported facts.',
  'Prepare model now ↗': 'Download missing memory weights and prepare the CPU embedding model.',
  'Host terminal commands': 'Allow host shell commands under the selected approval policy.',
  'Inference provider': 'Choose the local server or API service that generates chat responses.',
  'Server address':
    'Set the model server/API base address. Credentials are scoped to this address.',
  'Selected model': 'Choose from the complete discovered model list.',
  'Model ID': 'Enter an exact model identifier manually if it is absent from the catalog.',
  Language: 'Change interface labels without translating your authored content.',
  Personality:
    'Set the companion’s style; mandatory app guidance and native permissions still apply.',
  'System instructions': 'Add assistance preferences without replacing mandatory app instructions.',
  Theme: 'Choose the app palette and decorative artwork.',
  'New skill': 'Create reusable Markdown instructions for future agent work.',
  'New project': 'Create a project folder or attach an existing directory.',
  'New notebook': 'Create a collection for your notes and chapters.',
  'Open instructions ↗': 'Read or edit this skill’s reusable instructions.',
  'Skills view': 'Choose cards to browse skills or a compact list to scan more at once.',
};
function visibleExplanation(node: Element | null) {
  if (!node?.textContent?.trim() || !node.getClientRects().length || node.id === 'app-help-tooltip')
    return false;
  const style = getComputedStyle(node),
    rect = node.getBoundingClientRect();
  return (
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    style.opacity !== '0' &&
    style.clip === 'auto' &&
    style.clipPath === 'none' &&
    rect.width > 2 &&
    rect.height > 2
  );
}
function explanation(element: HTMLElement) {
  const explicit = element.dataset.tooltip || element.closest('label')?.dataset.tooltip;
  const label = element.closest('label');
  if (visibleExplanation(label?.querySelector('small') || null)) return null;
  const descriptions = element
    .getAttribute('aria-describedby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter(visibleExplanation);
  if (descriptions?.length) return null;
  if (explicit) return explicit;
  const labelText = label
    ? Array.from((label.querySelector(':scope > span') ?? label).childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(' ')
        .trim()
    : '';
  const candidates = [element.getAttribute('aria-label'), labelText, element.textContent?.trim()]
    .filter(Boolean)
    .map((v) => sourceText(v!.replace(/\s+/g, ' ').trim()).replace(/^[＋+]\s*/, ''));
  for (const candidate of candidates) if (help[candidate]) return t(help[candidate]);
  const text = candidates[0] || '';
  if (text.startsWith('Move to Trash'))
    return t('Move this item to Trash. Restore it later from Settings → Your data.');
  if (text.startsWith('Delete permanently'))
    return t('Permanently remove this trashed item and its contained items.');
  if (text.startsWith('Close ')) return t('Close this panel and return to your work.');
  if (text.startsWith('Open ')) return t('Open this item without sending anything to the model.');
  return null;
}
export default function Tooltips() {
  useLanguage();
  const [tip, setTip] = useState<{ target: HTMLElement; text: string } | null>(null),
    popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tracked: HTMLElement | null = null;
    let keyboard = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      tracked = null;
      setTip(null);
    };
    const show = (event: Event) => {
      if (event.type === 'focusin' && !keyboard) return;
      const element = (event.target as Element)?.closest<HTMLElement>(
        '[data-tooltip],button,summary,input,select,textarea',
      );
      if (!element || element.closest('[inert]')) {
        clear();
        return;
      }
      const text = explanation(element);
      if (!text) {
        clear();
        return;
      }
      if (tracked === element) return;
      tracked = element;
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => setTip({ target: element, text }),
        event.type === 'focusin' ? 0 : 450,
      );
    };
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    const leave = (event: PointerEvent) => {
      if (!tracked?.contains(event.relatedTarget as Node | null)) clear();
    };
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusout', clear);
    const pointer = () => {
      keyboard = false;
      clear();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || event.key.startsWith('Arrow')) keyboard = true;
      clear();
    };
    document.addEventListener('pointerdown', pointer);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', clear);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('pointerover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusout', clear);
      document.removeEventListener('pointerdown', pointer);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', clear);
    };
  }, []);
  useLayoutEffect(() => {
    if (!tip || !popup.current || !tip.target.isConnected) return;
    const rect = tip.target.getBoundingClientRect(),
      p = popup.current,
      size = p.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(rect.left, innerWidth - size.width - 8)) + 'px';
    p.style.top =
      (rect.top - size.height - 8 >= 40
        ? rect.top - size.height - 8
        : Math.min(rect.bottom + 8, innerHeight - size.height - 8)) + 'px';
    const old = tip.target.getAttribute('aria-describedby');
    tip.target.setAttribute(
      'aria-describedby',
      [old, 'app-help-tooltip'].filter(Boolean).join(' '),
    );
    return () => {
      if (old) tip.target.setAttribute('aria-describedby', old);
      else tip.target.removeAttribute('aria-describedby');
    };
  }, [tip]);
  return tip
    ? createPortal(
        <div ref={popup} role="tooltip" id="app-help-tooltip" className="help-tooltip">
          {tip.text}
        </div>,
        document.body,
      )
    : null;
}
