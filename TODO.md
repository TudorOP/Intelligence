# Intelligence 1.06 — release acceptance

The current workspace features are described in README.md. The 1.0 baseline passed 223 enabled backend checks. Current verification is recorded in docs/VERIFICATION.md. The 1.06 source is published on `main`; the acceptance gates below still apply before any binary/AppImage distribution. Verification procedures and limitations are documented in docs/VERIFICATION.md.

## Balanced profile — 1.06, 15 October 2026

- [x] Implement the selected concept A: identity/default model on the left, large central system-prompt editor, ratings/open tools on the right; omit User context.
- [x] Open More tool categories, Skills and MCP servers in focused dialogs, with search and adaptive pages instead of expanding/scrolling the profile or catalog.
- [x] Check every visible profile control, actual page/card overflow, dialogs, localization, themes, real zoom and short/larger windows with varied content. Verify profile drafts and tool/skill/server choices save correctly.
- [x] Update release docs, ignored source ZIP and local commit; no push or publication.

## Classic profile and resource modal — 1.05, 15 October 2026

- [x] Restore the 1.0 three-column profile arrangement from commit 830d401 while retaining current model selection, profile fields and native protections.
- [x] Keep ratings visible, a larger personality field and collapsed Tools and connections; open Resource access in a modal through a profile button.
- [x] Verify actual page scrolling, modal focus/Escape/grants and draft preservation in the affected profile fixture. Retain the [design references and final review](docs/design/agent-profile-2026-10-15/README.md).
- [x] Update release documentation and the ignored source ZIP, audit and commit locally; no push or publication.

## Profile, computer files and prompt follow-up — 1.04, 15 October 2026

- [x] Keep ratings open and prominent; use the available width so the standard 1080p profile fits, with expanded tools/access and bounded long catalogs.
- [x] Resolve home paths before native file checks; clarify and verify computer-wide file access outside projects, without requiring terminal commands or a project.
- [x] Rename the broad scope to Any file on the computer, explain its behavior in English/Romanian and give the agent native scope/home/working-directory information plus live access discovery.
- [x] Consolidate repeated mandatory guidance, load skill bodies on demand and preserve request prefixes across changing selections/skills/recall. Record the distinction between API history and engine cache reuse; real LM Studio/Qwen acceptance stays open below.
- [x] Run affected source/backend/UI checks, update release docs/source ZIP and commit locally. No push or publication.

## Collection layout follow-up — 1.03, 15 October 2026

- [x] Fix unequal collection card heights, including different rows, and align Skills availability/instruction actions.
- [x] Keep learned-skill provenance in its own list area; prevent cramped buttons, overlap and horizontal overflow.
- [x] Check affected Skills card/list themes, narrow/large panes, 125% scale, Romanian and the shared Projects/Connections layouts with varied content. Preserve the [two reported screenshots and review](docs/design/collection-layout-2026-10-15/README.md).
- [x] Record the standing preference to run relevant checks only, broadening only to debug an issue.

## Completed UI repairs — 1.02, 15 October 2026

The [repair checklist and six original screenshots](docs/design/ui-repairs-2026-10-15/README.md) preserve the reported defects and acceptance criteria. That Windows UI/theme review missed mixed-content Skills card/list defects subsequently reported by the user; the 1.03 follow-up above corrects them. See the linked review evidence and VERIFICATION.md; target-Linux acceptance remains open below.

- [x] Fix spacing and the repeated heading around Icons & identity (image 1).
- [x] Add consistent spacing and narrow-window wrapping between Notebook sharing and Task sharing (image 2).
- [x] Streamline Agent access and Access for each agent into a coherent flow, remove duplicated controls and preserve every native permission boundary (image 3).
- [x] Repair the agent profile layout so ratings and access sections do not leave large empty grid areas (image 4).
- [x] Fix shared model-picker scrolling so choices cannot overlap status text or the footer in either chat surface (images 5–6).
- [x] Complete a full UI pass across every screen and all ten themes: check consistent spacing, typography, controls, imagery, contrast and interaction states. Investigate the reported larger Chat image in Autumn against the same view in other themes; details and acceptance criteria are in the repair checklist.
- [x] Complete the checklist's visual, keyboard, localization and permission checks before marking these repairs complete; then follow the normal version/docs/archive/local-commit workflow.

## Required on the target Linux host

- [ ] Build the AppImage in Docker, run as a regular user, and verify Wayland/X11, fonts, scaling, tray and sandbox behavior.
- [ ] Validate real inference providers/models, tool quality with smaller models, credentials, MCP servers, ZIM archives, speech/dictation engines and audio/microphone lifecycle.
- [ ] Validate still-background decoding/blur/compositor behavior on target hardware at mixed DPI, 1080p and larger displays.
- [ ] Validate actual model residency, memory workers, recurring work, triggers, sleep/resume and RTC permissions.
- [x] Review the eight moderate npm audit findings in the electron-builder dependency chain before packaging; validate any dependency change without blindly applying forced fixes. Reviewed 20 October 2026: all eight trace to one root cause (`sprintf-js` unbounded-precision DoS via `roarr` → `global-agent@3` → `@electron/get` → `app-builder-lib`) in the build-only chain. None of the vulnerable packages ship in the AppImage; the shipped `global-agent@4.1.3` (via `onnxruntime-node`) is outside the advisory range. No forced dependency change was applied.
- [x] Audit the exact binary's dependency/content licenses and offer complete corresponding source matching each distributed AppImage. Completed 20 October 2026 for `release/Intelligence-1.0.6-x86_64.AppImage` (SHA-256 `96a6832100215650e17bc56a789b6fa7a2c3ec45348a1a62c7abc87b3a670eeb`): see docs/VERIFICATION.md. The six electron-builder native libs previously shipped without notices now carry complete texts in the offline catalog.

## Development constraints

Context-length benchmarks remain deferred. Token-overhead work is not queued. Animated backgrounds are explicitly deferred; reintegrate only on a new user request. Preserve user data, native permission/revision/approval checks, English/Romanian UI, original artwork and provenance.

Local release preparation does not authorize a push or publication.

## Before 1.0 implementation — deduplication and code cleanup

Complete this pass before implementing the new 1.0 settings, onboarding, help or agent configuration/access flows. Keep cleanup separate from feature changes and preserve current behavior. The sequence and acceptance requirements are included in [the 1.0 plan](docs/ONBOARDING_1_0_PLAN.md).

- [x] Record the current verification/performance baseline before cleanup.
- [x] Inspect repeated UI/forms, provider metadata/connection logic, settings persistence, chat/approval presentation, localization/help and native validation; identify which duplication can safely share one implementation.
- [x] Consolidate equivalent logic/components and remove proven unused code/imports and obsolete paths in small, reviewable commits. Preserve intentional differences between Tasks/Matrix, resource access/task assignment and renderer/native authority.
- [x] Preserve user data, migrations/backups, English/Romanian content, mandatory harness guidance, live permission/revision/approval checks, artwork/provenance and full license notices. Avoid speculative abstractions, dependency churn and cosmetic rewrites.
- [x] Run affected regressions/desktop fixtures, backend tests, build and source checks; compare performance with the baseline and document remaining intentional duplication before starting 1.0 feature implementation.

## 1.0 implementation — authorized local work

Develop on `dev`; `main` holds reviewed releases. The reviewed plan is implemented locally; final verification and source packaging are recorded below. Details, sequence, design concepts and acceptance criteria are in [ONBOARDING_1_0_PLAN.md](docs/ONBOARDING_1_0_PLAN.md).

- [x] Review the six-stage first-use setup, provider assistance and optional feature lessons.
- [x] Complete and verify the prerequisite deduplication/code cleanup pass above before implementing these features.
- [x] Implement persisted setup progress, save/exit/resume and safe Settings return paths.
- [x] Share profile/companion and provider forms with Settings; add plain-language connection diagnosis.
- [x] Add explicit first-use access, memory/download and automation choices without changing existing users' preferences.
- [x] Add an offline English/Romanian written guide under Settings → Help & setup.
- [x] Add native requests for narrowly scoped access and reviewed configuration, with current-request and per-agent persistent choices in both chat surfaces.
- [x] Verify local lifecycle, stale/revoked approvals, localization, keyboard access, ten themes and responsive layouts. Target Linux/live-provider/device acceptance remains separately open above.
- [x] Record the current performance baseline and compare startup, idle resources, bundle size and Settings/Chat responsiveness as the 1.0 phases land; keep closed setup/help features free of recurring work. The isolated 0.94/1.0 comparison and measurement limits are recorded in docs/VERIFICATION.md.

- [x] Refresh release docs and Intelligence-source.zip after the final build/test/screenshot/performance pass; create the local 1.0 commit with scripts/commit-version.mjs. This completion record is included in the source archive prepared immediately before that commit; no push or publication is authorized.

## 1.01 workspace and automation

The authorized implementation and acceptance checklist are recorded in [WORKSPACE_1_01_PLAN.md](docs/WORKSPACE_1_01_PLAN.md). This update includes project/window state, shared model/agent selection, retained conversation sources, native computer scopes, managed command jobs and continuous inbox queues. Packaging/publication still require the target-Linux and exact binary/source/license gates above.

## Development continuity

- [x] Record a harness-independent [agent handoff](docs/AGENT_HANDOFF.md) with the current checkpoint, required reading, verification commands, version mapping, local commit/source-ZIP sequence and explicit remote authorization rules. Link it from the project entry points and retain version 1.01 for this documentation-only follow-up.
- [x] Document that the local source archive is refreshed after verified source/doc changes, ignored through \*.tar.gz and excluded from Git pushes. Preserve the separate binary/source/license release gates above.
