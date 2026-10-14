export function trashRoots(store, ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100000 ||
    ids.some((id) => typeof id !== 'string')
  )
    throw Error('Choose items in Trash');
  const selected = new Set(ids),
    items = [...selected].map((id) => store.get(id, true));
  if (items.some((item) => !item?.deleted)) throw Error('Trash changed; refresh before deleting');
  return items
    .filter((item) => {
      let current = item;
      const seen = new Set();
      while (current?.parent && !seen.has(current.parent)) {
        if (selected.has(current.parent)) return false;
        seen.add(current.parent);
        current = store.get(current.parent, true);
      }
      return true;
    })
    .map((item) => item.id);
}
export async function deleteTrashBatch(store, ids, deleteOne) {
  const roots = trashRoots(store, ids),
    deleted = [],
    failed = [];
  let retainedAssets = 0;
  for (let at = 0; at < roots.length; at++) {
    const id = roots[at];
    try {
      const result = await deleteOne(id);
      deleted.push(...result.deleted);
      retainedAssets += result.retainedAssets || 0;
    } catch (e) {
      failed.push({ id, error: e.message });
    }
    if (at % 50 === 49) await new Promise((resolve) => setImmediate(resolve));
  }
  return { deleted: [...new Set(deleted)], failed, retainedAssets };
}
