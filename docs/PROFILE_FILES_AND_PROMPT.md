# Profile, native computer files and prompt requests — 1.04

This implements the user's 15 October 2026 requests: visible ratings without page scrolling at 1080p, a leaner/stabler prompt, correction of `~/Downloads` resolving under a project, and understandable computer-wide file access. It is local work on dev; no remote action is authorized.

## Historical 1.04 profile

The user subsequently requested the 1.0 arrangement with a resource-access modal. That 1.05 implementation replaces the layout below; see [the final profile review](design/agent-profile-2026-10-15/README.md). Native file/prompt behavior in the rest of this document remains current.

Four columns use the available 1080p width: identity/user context, ratings/model, tools/connections, and resource access. Ratings start at the top and cannot be collapsed. Tool categories and profile access start open; long skills/server/resource lists scroll independently. Existing controls, texts, rating persistence and draft preservation remain. Shorter/narrower windows can require page scrolling for later sections; arbitrary long text/catalogs cannot all occupy a fixed viewport at once. Content remains reachable.

## Native computer files

The broad setting is **Any file on the computer**, with an English/Romanian explanation of outside-project files, OS permissions, per-agent restrictions and separate action/terminal controls. The profile category is **Computer & project files**, because it governs both.

Every ordinary chat gets a compact native snapshot of effective scope, actual home and working directory. `computer_files(action=access)` reports current scope/policies and authorized roots on demand. Under `system`, listing and reading outside projects do not ask for another folder grant. Writes still use native approval policy. Neither a project nor terminal access is required. `read_file` no longer incorrectly instructs the model to ask for every outside-project read. Existing protected app storage, read-only/excluded projects, profile restrictions, symlink canonicalization, revisions and live revalidation remain.

`~` and `~/...` expand before canonicalization/authorization; ordinary relative paths retain project-or-home behavior. Named-user tildes return a clear error. Matrix output tracking uses the same resolver. Fixtures touch isolated files only, not the user's Downloads.

The comparison used primary sources. [OpenCode permissions](https://opencode.ai/docs/permissions/) separates external-directory scope from read/edit approval and supports home expansion. [Hermes security](https://hermes-agent.nousresearch.com/docs/user-guide/security) separates its optional write safe roots from protected paths; its [file implementation](https://github.com/nousresearch/hermes-agent/blob/main/tools/file_tools.py) reports resolved paths. Intelligence retains its existing native policy rather than importing either harness's permission model or adding their unrelated features.

## Prompt changes and the LM Studio log

A greeting can include far more than its visible text: mandatory guidance, user style, tool definitions, retrieved context, history and the server's chat template all contribute. No tokenizer breakdown, overhead estimate or context-length benchmark was run here.

Repeated core guidance is consolidated. Relevant skills are names/IDs/revisions in saved turn context; the model must call `skill_action(read)` for current complete instructions. Up to eight skill bodies are no longer inlined/truncated into a changing system message. Selected-resource names also belong to their user turn. Historical skill metadata respects current access/profile exclusions; old ungranted selection names and revoked project working paths are filtered on replay. Native authority does not depend on prompt text.

The [LM Studio Chat Completions endpoint](https://lmstudio.ai/docs/developer/openai-compat/chat-completions) takes conversation messages on each request. Sending history is necessary with this endpoint; it does not imply the engine must compute every token again. [llama.cpp's server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) describes reusing a cached common prefix when available. Request-prefix stability is tested across changing recall/selections/skill revisions, tool exchanges and a Store restart.

The supplied log shows substantial prompt evaluation on both turns, and a slot chosen by prefix similarity. It does not identify the first differing rendered token, cache eviction or recurrent-state availability. [The upstream Qwen hybrid/recurrent issue](https://github.com/ggml-org/llama.cpp/issues/20225) documents a separate reason for full reprocessing. This is a possible engine-side explanation, not a diagnosis of the user's installed LM Studio runtime. Its version, model template, cache/checkpoint behavior and other requests sharing the model need target-host inspection if reprocessing persists. No server-specific cache fields, slot pinning, forced runtime updates or claims of measured inference speedup are introduced.

See [VERIFICATION.md](VERIFICATION.md) for fresh checks and remaining Linux/live-provider limits. Existing context benchmark exclusions and the absence of a standing token-overhead queue remain.
