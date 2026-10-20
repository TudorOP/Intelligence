// Approval policy is user-controlled; document/tool text cannot change it.
export function automaticApproval(mode, action = {}, settings = {}) {
  if (action.requiresReview === true) return false;
  if (settings.askDestructive && action.destructive) return false;
  if (mode === 'full') return true;
  if (mode !== 'auto') return false;
  if (action.type === 'computer-file' && action.inScope && !action.destructive) return true;
  if (action.type === 'project-write' && action.insideProject === true) return true;
  if (action.type === 'project-mutation' && action.insideProject === true && !action.destructive)
    return true;
  if (action.type === 'command' && action.project === true) {
    const command = String(action.command ?? '').trim();
    return /^(pwd|ls(?: -[alh]+)?(?: \.)?|git status(?: --short)?|git diff(?: --stat)?|git log -[1-9][0-9]? --oneline)$/.test(
      command,
    );
  }
  return false;
}
