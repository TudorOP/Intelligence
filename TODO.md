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
