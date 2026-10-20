# Releases

## 1.06 — balanced agent profile on dev

- Implement the selected concept A: image/name and default model in the left column, a large system-prompt editor in the center, and visible ratings and Tools and connections on the right. Remove the User context block from this screen.
- Open More tool categories, Skills and MCP servers in keyboard-accessible dialogs with search and adaptive pages. Long catalogs do not require page or dialog scrolling; choices remain profile drafts until Save profile.
- Retain native access enforcement, mandatory instructions, existing artwork and English/Romanian content. Remove the profile's duplicate Model ID toggle while retaining its explicit editable field and model picker.
- Verify profile controls and dialog contents stay visible across the tested desktop sizes, themes and real 125% zoom, with long prompts/catalogs and an open assistant. Prepare 1.06/package 1.0.6 locally; no push, merge or publication.

## 1.05 — classic agent profile and resource-access modal on dev

- Restore the 1.0 profile arrangement: identity/personality, model/tools, and ratings/user context in three columns. Keep a larger personality field, modern searchable models and current profile save behavior.
- Replace the in-page resource-access column with a profile button opening the shared grant editor in the native-style modal. Preserve unsaved preferences and ratings across live grant edits, Escape/focus restoration and keyboard containment.
- Keep Tools and connections collapsed in a viewport-bounded menu. Retain original category grouping without duplicates, newer computer scope and skill restrictions, English/Romanian labels and saved values.
- Strengthen the focused fixture to measure the actual main-canvas scroll range and use real Electron zoom rather than CSS body zoom. Retain generated design studies separately from the final 1.0-style implementation.
- Prepare 1.05/package 1.0.5 locally. No push, merge or publication.

## 1.04 — visible profile ratings, computer files and stable prompts on dev

- Use four compact profile columns at 1080p with ratings first, expanded tool/access sections and independent scrolling for long catalogs. Preserve rating saves, unsaved preferences and live grants.
- Expand current-user home paths before native scopes/approvals. Replace the broad file-scope label with Any file on the computer, explain OS/profile limits in EN/RO and clarify the Computer & project files category.
- Give chat a native effective-file-scope/home/working-directory snapshot and computer_files(action=access) for live scope. Correct the misleading read_file instruction that always demanded approval outside projects; verify outside-project reads/writes with terminal access off and with/without an active project.
- Consolidate repeated mandatory guidance. Supply relevant skill metadata in saved user-turn context and load current full instructions through skill_action; selected names no longer rewrite the system message. Keep native authority and historical source filtering.
- Explain repeated context transmission versus engine prompt-cache reuse without claiming live inference speedups. Prepare 1.04/package 1.0.4 locally; no push or publication.

## 1.03 — collection card and Skills list repairs on dev

- Give Skills, Projects and Connections matching card dimensions within each collection, including across rows. Wrap long titles/paths/descriptions and align card actions.
- Align Skills availability/instruction actions, reserve provenance space and use explicit list areas so optional learned-skill metadata cannot displace the instruction button. Adapt to available pane width, including the assistant.
- Preserve the two new visual references and add a focused production Electron collection fixture with varied content, themes, responsive/localized states and real Skills controls.
- Record relevant-tests-only as the standing development rule; expand coverage only to debug an issue. Prepare 1.03/package 1.0.3 locally; no new push or publication.

## 1.02 — UI repairs and theme consistency on dev

- Space the Icons & identity disclosure and sharing buttons; remove repeated disclosure headings.
- Consolidate workspace/memory switches and selected-agent resource policy, with expandable grant details and computer controls. Keep native permission, revision and approval behavior intact.
- Arrange agent identity/ratings in one independent column, model/tools in another and resource access in a third, adapting to the available workspace width. Show each tool category once and persist the skill-creation switch with the profile.
- Give model choices their own bounded scroll area; keep status and the providers action clear, focused options visible and ordinary Home/End text editing available in search.
- Normalize Chat artwork bounds across all ten themes, correcting the larger Autumn override without changing assets. Improve secondary/small-label text contrast within the existing palettes.
- Add a production Electron fixture for the reported defects and the full screen/theme review, with long catalogs, grant controls, keyboard checks, short/larger windows, text scaling, Romanian, setup/help and dialogs. Preserve the six original references and feedback.
- Prepare public 1.02/package 1.0.2 locally. Target-Linux/live-provider/binary-release checks remain open; no push, merge or publication.

## 1.01 — local workspace and automation update on dev

- Documentation follow-up: add a harness-independent agent handoff, update architecture/Linux/release guidance, and document local commits, source-ZIP regeneration and separate remote authorization. Application/package versions stay 1.01/1.0.1.

- Restore the selected project and normal/maximized window bounds; first launch fits a smaller 1280×800 window.
- Share searchable model/agent pickers, symbolic chat model buttons and a unified Add sources dialog with resource trees.
- Support text/PDF/DOCX/image attachments, bounded folder snapshots, explicit project retention, branch-aware cleanup and backup inclusion.
- Assign agent profiles to Matrix lists and Tasks, preserve prior Matrix model choices as migrated profiles, and retain the assigned model when preparation is disabled.
- Centralize computer scope, additional read/edit folders, command approvals and destructive-action protection; expose effective per-agent access and the same grants editor in profiles.
- Add managed command jobs with incremental output, ownership, polling/input, cancellation, bounded execution and outcome guards.
- Add continuous Matrix inbox monitoring with readiness checks, durable per-file queues, busy/startup/resume catch-up, output deduplication and execution history.
- Consolidate Icons under Look & feel and command policy under Agent access; retain EN/RO help, mandatory native permission/revision checks, artwork and licenses.
- Prepare public label 1.01/package 1.0.1 locally. No push, main merge, binary build or publication. Target-Linux/live-provider acceptance remains open.

## 1.0 — local development milestone on dev

- Completed the prerequisite provider catalog/profile-form deduplication and verified cleanup as a separate commit.
- Replaced the old setup with six resumable, optional stages; shared profile/provider controls, biography/privacy choices, inline novice provider instructions, explicit reply test, Settings return, and safe completion/review.
- Added a searchable offline English/Romanian written guide and four optional feature lessons under Help & setup.
- Added exact current-request/per-agent persistent native resource requests in both chats, visible grants/revocation and names-only context selection before authorization. Live scopes, native gates, source checks, revisions and command/MCP approvals stay enforced.
- Added reviewed current-agent name/style/connected-model proposals with visible before/after values. New collections can receive reviewed temporary or permanent editing access without sharing them globally.
- Added protected endpoint-bound authentication for local servers, connection-test invalidation and stopped runs when their credentials change.
- Lazy-loaded Settings/setup/help and selected-language guide content; removed duplicate bootstrap entity/profile work and bounded context/resource pickers.
- Retained four ImageGen design concepts and provenance. Actual implementation screenshots and test reports are separate fixture artifacts.
- Prepared package 1.0.0 and public label 1.0 locally. No push, main merge or publication is authorized. Linux/live-provider/device and exact binary/license/source gates remain open.

## 0.94

- Local-first Linux desktop workspace with persistent chat, conversation branches, agent profiles, live permissions and protected provider credentials.
- Notebooks, chapters, Markdown notes and a real-file Vault; recoverable Trash, revisions and portable backups.
- Tasks/Kanban for user and optional agent work, with contextual agent controls; a separate agent-only Cognition Matrix with scheduled work and outcomes.
- Multiple connected inference providers, provider/model selection per conversation, individual disconnection and configurable tool rounds.
- Conversation steering between model/tool steps, completed-write persistence on Stop, and visible saved chapter content with a preserved copy into a child note.
- Typed native tools for notes, files, projects, Calendar, reports and memory, with enforced permissions, revisions and approvals.
- User-requested MCP setup with explicit native configuration review, stdio/Streamable HTTP support and a bundled setup skill.
- Ten themes with original artwork, independent still backgrounds, image strength/blur and English/Romanian UI.
- Optional local speech, dictation and offline archive engines provisioned separately from the application.

Target Linux runtime, live-provider/model/device acceptance and the exact binary/license/source audit remain required before binary distribution. See TODO.md and docs/RELEASE_CHECKLIST.md.
