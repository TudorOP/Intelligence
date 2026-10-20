export function assignedAgent(store, item) {
  const seen = new Set();
  for (
    let current = item;
    current && !seen.has(current.id);
    current = current.parent ? store.get(current.parent) : null
  ) {
    seen.add(current.id);
    if (current.data.assignedAgent) return current.data.assignedAgent;
  }
  return store.settings().activeAgent;
}
export function requireAssignedAgent(store, item) {
  const id = assignedAgent(store, item);
  if (store.get(id)?.kind !== 'agent-profile')
    throw Error('The assigned agent is unavailable. Choose another agent.');
  return id;
}
