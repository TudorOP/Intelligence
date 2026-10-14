import { randomUUID } from 'node:crypto';
import { inferenceProviders, providerInfo } from './inference-providers.mjs';
import {
  setupToolNames,
  validateResourceGrants,
  normalizeResourceGrants,
} from './agent-access.mjs';
export const ratingKeys = ['intelligence', 'knowledge', 'toolUse', 'longTasks'];
export const profileGroups = [
  'workspace',
  'projects',
  'memory',
  'search',
  'machine',
  'terminal',
  'matrix',
  'connections',
  'calendar',
  'reports',
];
export function validateProfile(data) {
  if (data.resourcePolicy !== undefined && !['shared', 'ask'].includes(data.resourcePolicy))
    throw Error('Invalid agent resource policy');
  if (data.resourceGrants !== undefined) validateResourceGrants(data.resourceGrants);
  if (
    data.allowConfigurationRequests !== undefined &&
    typeof data.allowConfigurationRequests !== 'boolean'
  )
    throw Error('Invalid setup-request preference');
  if (data.allowSkillCreation !== undefined && typeof data.allowSkillCreation !== 'boolean')
    throw Error('Invalid skill creation preference');
  if (data.inheritModel !== undefined && typeof data.inheritModel !== 'boolean')
    throw Error('Invalid model inheritance');
  const ratings = Object.fromEntries(ratingKeys.map((key) => [key, data.ratings?.[key] ?? 0]));
  if (Object.values(ratings).some((v) => !Number.isInteger(v) || v < 0 || v > 5))
    throw Error('Ratings must be between 0 and 5 stars');
  if (data.provider && !inferenceProviders.some((p) => p.id === data.provider))
    throw Error('Choose an inference provider');
  for (const key of ['model', 'personality', 'systemPrompt', 'avatar'])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== 'string' || data[key].length > (key === 'personality' ? 50000 : 20000))
    )
      throw Error('Invalid agent profile');
  for (const key of ['toolGroups', 'skillIds', 'connectionIds'])
    if (
      data[key] !== null &&
      data[key] !== undefined &&
      (!Array.isArray(data[key]) ||
        data[key].length > 200 ||
        data[key].some((id) => typeof id !== 'string'))
    )
      throw Error('Invalid profile scope');
  if (data.toolGroups?.some((v) => !profileGroups.includes(v))) throw Error('Unknown tool group');
  return { ...data, ratings, performance: ratingKeys.reduce((sum, k) => sum + ratings[k], 0) / 4 };
}
export function ensureProfiles(store) {
  const settings = store.settings();
  if (settings.preferencesVersion !== 1 && settings.systemPrompt) {
    store.setSettings({
      personality: mergePreferences(settings.personality, settings.systemPrompt),
      systemPrompt: '',
    });
  }
  let profiles = store.all(false, true).filter((e) => e.kind === 'agent-profile');
  if (!profiles.length) {
    const s = store.settings();
    if (!store.firstRun) store.setSettings({ onboardingComplete: true });
    profiles = [
      store.mutate({
        kind: 'agent-profile',
        title: s.agentName,
        data: validateProfile({
          avatar: s.avatar,
          provider: s.provider,
          model: s.model,
          inheritModel: true,
          personality: s.personality,
          systemPrompt: s.systemPrompt,
          toolGroups: null,
          skillIds: null,
          connectionIds: null,
          access: false,
        }),
      }),
    ];
  }
  if (!profiles.some((p) => p.id === store.settings().activeAgent))
    store.setSettings({ activeAgent: profiles[0].id });
  profiles = profiles.map((p) =>
    p.data.preferencesVersion === 1
      ? p
      : store.mutate({
          id: p.id,
          data: {
            personality: mergePreferences(p.data.personality, p.data.systemPrompt),
            systemPrompt: '',
            preferencesVersion: 1,
          },
        }),
  );
  for (const conversation of store
    .all(false, true)
    .filter((e) => e.kind === 'conversation' && !e.data.agentProfile))
    store.mutate({ id: conversation.id, data: { agentProfile: profiles[0].id } });
  return profiles;
}
export function profileSettings(store, conversation = null) {
  const base = store.settings(),
    profile = store.get(conversation?.data.agentProfile ?? base.activeAgent);
  if (profile?.kind !== 'agent-profile') {
    const provider = conversation?.data.branchProvider ?? base.provider;
    return {
      ...base,
      ...(provider === base.provider
        ? {}
        : (base.providerProfiles?.[provider] ?? { endpoint: providerInfo(provider).endpoint })),
      provider,
      providerProfiles: {
        ...base.providerProfiles,
        [base.provider]: {
          endpoint: base.endpoint,
          model: base.model,
          visionEnabled: base.visionEnabled,
        },
      },
      model: conversation?.data.branchModel || base.model,
    };
  }
  const provider =
    conversation?.data.branchProvider ??
    (profile.data.inheritModel ? base.provider : profile.data.provider || base.provider);
  return {
    ...base,
    ...(provider === base.provider
      ? base
      : (base.providerProfiles?.[provider] ?? { endpoint: providerInfo(provider).endpoint })),
    provider,
    providerProfiles: {
      ...base.providerProfiles,
      [base.provider]: {
        endpoint: base.endpoint,
        model: base.model,
        visionEnabled: base.visionEnabled,
      },
    },
    model:
      conversation?.data.branchModel ||
      (profile.data.inheritModel ? base.model : (profile.data.model ?? '')),
    agentName: profile.title,
    avatar: profile.data.avatar ?? '',
    personality: profile.data.personality ?? base.personality,
    systemPrompt: profile.data.systemPrompt ?? base.systemPrompt,
    profileId: profile.id,
    profileScope: profile.data,
  };
}
export function toolGroup(name) {
  if (name === 'calendar_action') return 'calendar';
  if (name === 'reports_action') return 'reports';
  if (
    name.startsWith('mcp_') ||
    name === 'discover_connection_tools' ||
    name === 'connection_action'
  )
    return 'connections';
  if (name.startsWith('project_')) return 'projects';
  if (
    /^(remember|recall_memory|search_memory|forget_memory|search_conversations|read_conversation)$/.test(
      name,
    )
  )
    return 'memory';
  if (name === 'zim_action') return 'search';
  if (/search_web|web_search|browse_web/.test(name)) return 'search';
  if (/terminal|host_command|run_command/.test(name)) return 'terminal';
  if (name === 'read_file' || name === 'write_file') return 'projects';
  if (/machine|inspect_|container|logs/.test(name)) return 'machine';
  if (/matrix|schedule_task|task_result/.test(name)) return 'matrix';
  return 'workspace';
}
export function mergePreferences(personality = '', legacy = '') {
  return [personality, legacy && legacy.trim() !== personality.trim() ? legacy : '']
    .filter(Boolean)
    .join('\n\nAdditional preferences:\n');
}
export function profileAllows(store, settings, name, connections) {
  const live = store.get(settings.profileId);
  if (settings.profileId && (!live || live.deleted)) return false;
  if (
    settings.conversationId &&
    store.get(settings.conversationId)?.data.agentProfile !== settings.profileId
  )
    return false;
  const scopes = [settings.profileScope, live?.data].filter(Boolean);
  if (setupToolNames.has(name))
    return scopes.every((scope) => scope.allowConfigurationRequests !== false);
  return scopes.every(
    (scope) =>
      (!scope.toolGroups || scope.toolGroups.includes(toolGroup(name))) &&
      (!name.startsWith('mcp_') ||
        !scope.connectionIds ||
        scope.connectionIds.includes(connections.registry?.get(name)?.id)),
  );
}
export function profileAction(store, input) {
  const profiles = ensureProfiles(store);
  if (input.action === 'list') return profiles;
  if (input.action === 'select') {
    if (!profiles.some((p) => p.id === input.id)) throw Error('Agent profile not found');
    store.setSettings({ activeAgent: input.id });
    return store.get(input.id);
  }
  if (input.action === 'delete') {
    if (profiles.length < 2) throw Error('Keep at least one agent profile');
    if (!profiles.some((p) => p.id === input.id)) throw Error('Agent profile not found');
    store.mutate({ id: input.id, action: 'trash' });
    if (store.settings().activeAgent === input.id)
      store.setSettings({ activeAgent: profiles.find((p) => p.id !== input.id).id });
    return { deleted: true };
  }
  if (input.action === 'save') {
    if (!input.id && profiles.length >= 40) throw Error('At most 40 agent profiles are supported');
    const old = input.id ? store.get(input.id) : null;
    if (input.id && old?.kind !== 'agent-profile') throw Error('Agent profile not found');
    if (old && input.revision !== old.revision)
      throw Error('This profile changed. Reload before saving.');
    if (input.data?.resourceGrants !== undefined)
      input = {
        ...input,
        data: {
          ...input.data,
          resourceGrants: normalizeResourceGrants(
            store,
            input.data.resourceGrants,
            old?.data.resourceGrants,
          ),
        },
      };
    return store.mutate({
      id: input.id,
      kind: 'agent-profile',
      revision: input.revision,
      title: input.title ?? old?.title ?? 'New agent',
      data: validateProfile({
        ...old?.data,
        ...input.data,
        personality: mergePreferences(
          input.data?.personality ?? old?.data.personality ?? '',
          input.data?.systemPrompt ?? old?.data.systemPrompt ?? '',
        ),
        systemPrompt: '',
        preferencesVersion: 1,
        access: false,
      }),
    });
  }
  throw Error('Unknown profile action');
}
