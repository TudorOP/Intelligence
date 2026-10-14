# Intelligence 0.94 — release acceptance

The current workspace features are described in README.md. Source checks, all 207 enabled backend checks, the production build and the isolated desktop smoke pass. Source publication is separate from the remaining binary-release gates. Verification procedures and limitations are documented in docs/VERIFICATION.md.

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

## Proposed for 1.0 — awaiting plan review

Develop on `dev`; `main` holds reviewed releases. This list records proposed work, not completed functionality. Details, sequence, design concepts and acceptance criteria are in [ONBOARDING_1_0_PLAN.md](docs/ONBOARDING_1_0_PLAN.md).

- [ ] Review the six-stage first-use setup, provider assistance and optional feature lessons.
- [x] Complete and verify the prerequisite deduplication/code cleanup pass above before implementing these features.
- [ ] Implement persisted setup progress, save/exit/resume and safe Settings return paths.
- [ ] Share profile/companion and provider forms with Settings; add plain-language connection diagnosis.
- [ ] Add explicit first-use access, memory/download and automation choices without changing existing users' preferences.
- [ ] Add an offline English/Romanian written guide under Settings → Help & setup.
- [ ] Add native requests for narrowly scoped access and reviewed configuration, with current-request and per-agent persistent choices in both chat surfaces.
- [ ] Verify lifecycle, stale/revoked approvals, localization, keyboard access, ten themes, responsive layouts and Linux/live-provider release gates.
- [ ] Record the current performance baseline and compare startup, idle resources, bundle size and Settings/Chat responsiveness as the 1.0 phases land; keep closed setup/help features free of recurring work.
