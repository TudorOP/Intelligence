import { providerInfo } from './inference-providers.mjs';

export function matrixInference(settings, profile = null) {
  if (!profile) return { ...settings };
  const info = providerInfo(profile.provider);
  const saved =
    settings.provider === profile.provider
      ? settings
      : settings.providerProfiles?.[profile.provider];
  return {
    ...settings,
    provider: profile.provider,
    endpoint: saved?.endpoint ?? info.endpoint,
    model: profile.model,
    visionEnabled: saved?.visionEnabled ?? true,
    contextOverride: 0,
  };
}

export function validateMatrixProfile(profile) {
  if (profile === null || profile === undefined) return;
  if (typeof profile !== 'object' || Array.isArray(profile))
    throw Error('Invalid Matrix model profile');
  providerInfo(profile.provider);
  if (typeof profile.model !== 'string' || !profile.model.trim() || profile.model.length > 500)
    throw Error('Choose a Matrix model');
  if (Object.keys(profile).some((key) => !['provider', 'model'].includes(key)))
    throw Error('Matrix model profiles contain only provider and model');
}

export function validateMatrixTrigger(store, id, trigger) {
  if (!trigger || trigger.kind === 'time') return;
  if (!['completion', 'file', 'git', 'system', 'external'].includes(trigger.kind))
    throw Error('Invalid Matrix trigger');
  if (
    !Number.isInteger(trigger.cooldownSeconds ?? 60) ||
    (trigger.cooldownSeconds ?? 60) < 5 ||
    (trigger.cooldownSeconds ?? 60) > 86400
  )
    throw Error('Trigger cooldown must be from 5 to 86400 seconds');
  const source = store.get(trigger.source);
  if (trigger.kind === 'external') {
    if (typeof trigger.channel !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(trigger.channel))
      throw Error('Choose a short external event channel');
    return;
  }
  if (trigger.kind === 'system') {
    if (
      source?.kind !== 'machine' ||
      !store.access(source.id) ||
      !['memory', 'cpu'].includes(trigger.metric) ||
      !Number.isFinite(trigger.threshold) ||
      trigger.threshold < 1 ||
      trigger.threshold > 100
    )
      throw Error('Choose an accessible machine and a threshold from 1 to 100');
    return;
  }
  if (trigger.kind === 'git') {
    if (
      source?.kind !== 'project' ||
      !store.access(source.id) ||
      !['commit', 'branch'].includes(trigger.event)
    )
      throw Error('Choose an accessible Git project and event');
    return;
  }
  if (trigger.kind === 'completion') {
    if (!['matrix-task', 'card'].includes(source?.kind) || source.id === id)
      throw Error('Choose another task as the completion trigger');
    if (
      source.kind === 'matrix-task' &&
      store.children(source.id, true).some((child) => child.id === id)
    )
      throw Error('A subtask cannot depend on its parent completing first');
    const visited = new Set([id]);
    let current = source;
    while (current) {
      if (visited.has(current.id)) throw Error('Task dependencies cannot form a cycle');
      visited.add(current.id);
      current =
        current.data.trigger?.kind === 'completion' ? store.get(current.data.trigger.source) : null;
    }
  } else {
    if (!['project', 'vault-folder', 'vault-file'].includes(source?.kind))
      throw Error('Choose a project or Vault item to watch');
    if (typeof (trigger.path ?? '.') !== 'string' || String(trigger.path ?? '.').length > 1000)
      throw Error('Invalid watched path');
  }
}
