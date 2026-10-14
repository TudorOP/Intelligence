// Approval policy is user-controlled; document/tool text cannot change it.
export function automaticApproval(mode, action = {}) {
  if (action.requiresReview === true) return false;
  if (mode === 'full') return true;
  if (mode !== 'auto') return false;
  if (action.type === 'project-write' && action.insideProject === true) return true;
  if (action.type === 'command' && action.project === true) {
    const command = String(action.command ?? '').trim();
    return /^(pwd|ls(?: -[alh]+)?(?: \.)?|git status(?: --short)?|git diff(?: --stat)?|git log -[1-9][0-9]? --oneline)$/.test(
      command,
    );
  }
  return false;
}
