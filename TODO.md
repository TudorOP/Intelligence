# Intelligence 1.01 — release acceptance

The current workspace features are described in README.md. The 1.0 baseline passed 223 enabled backend checks. Current 1.01 verification is recorded in docs/VERIFICATION.md. Source publication is separate from the remaining binary-release gates. Verification procedures and limitations are documented in docs/VERIFICATION.md.

## Required on the target Linux host

- [ ] Build the AppImage in Docker, run as a regular user, and verify Wayland/X11, fonts, scaling, tray and sandbox behavior.
- [ ] Validate real inference providers/models, tool quality with smaller models, credentials, MCP servers, ZIM archives, speech/dictation engines and audio/microphone lifecycle.
- [ ] Validate still-background decoding/blur/compositor behavior on target hardware at mixed DPI, 1080p and larger displays.
- [ ] Validate actual model residency, memory workers, recurring work, triggers, sleep/resume and RTC permissions.
- [ ] Review the eight moderate npm audit findings in the electron-builder dependency chain before packaging; validate any dependency change without blindly applying forced fixes.
- [ ] Audit the exact binary's dependency/content licenses and offer complete corresponding source matching each distributed AppImage.

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
- [x] Document that Intelligence-source.zip is refreshed locally after verified source/doc changes, ignored through \*.zip and excluded from Git pushes. Preserve the separate binary/source/license release gates above.
