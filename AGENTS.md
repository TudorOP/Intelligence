# Intelligence project handoff

Read [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md) together with README.md, TODO.md and UI_UX.md before starting. The handoff doc is the authoritative workflow: session checks, current checkpoint, verification commands, version/commit/archive procedure and Linux release gates. Inspect Git status before editing and before committing.

Develop new work on dev; main holds reviewed releases and remains the GitHub default branch. Local commits after verified requested work are part of the standing workflow; they do not authorize remote actions. Pushing, merging to main, tagging or publishing require an explicit user request. Keep commits reviewable; do not discard unrelated work or rewrite established public history without explicit authorization.

Target 1920×1080 first, support larger/shorter windows and preserve English/Romanian UI and user-authored content. Preserve artwork and provenance. Run only tests and fixtures relevant to the change; do not run the full suite by default.

Core is the fixed Cognition Matrix list name. Secondary and Tertiary are freely renameable. Mandatory harness instructions remain present when editable personality/prompt preferences change. Native resource, revision, approval and live profile checks must remain enforced.

Still backgrounds are independent from theme and background AI. Keep them pointer-transparent, offer persisted blur/strength controls, and preserve bounded imported images in backups. Animated backgrounds are withdrawn and explicitly deferred; do not reintegrate without a new user request. Pause AI controls automatic tasks/memory, not decorative imagery or foreground chat.

Context-length testing remains deferred. Token-overhead testing/estimation is not queued and must not be resumed.

Original code is GPL-3.0-only. Preserve full local license text and third-party notices. Public distribution requires an exact Linux binary/license/source audit and complete corresponding source matching the binary, including required dependencies and build scripts. See docs/RELEASE_CHECKLIST.md.
