# Intelligence project handoff

Read README.md, TODO.md and UI_UX.md before starting. Develop new work on dev; main holds reviewed releases and remains the GitHub default branch. Push new changes to dev first only when authorized; merge to main and publish only on an explicit user request. Target 1920×1080 first, support larger/shorter windows and preserve English/Romanian UI and user-authored content.

Read [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md) for the harness-independent workflow, current checkpoint, verification commands and commit/archive procedure. Inspect Git status before editing and before committing. Local commits after verified requested work are part of this workflow; they do not authorize remote actions.

The current release and package version are recorded in [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md) and package.json; do not hardcode them in this file. Normal app updates add 0.01 to the public label (for example 1.06 → 1.07). Use scripts/bump-version.mjs; it maps the public label to a valid semantic package version. After verification, update release docs and Intelligence-source.zip, then run scripts/commit-version.mjs for a local commit. Do not push or publish without an explicit user request.

Documentation-only follow-ups keep the current application version unless the user requests a new release. The source ZIP is intentionally ignored by \*.zip and must be refreshed locally, never force-added to Git. Stage intended new source/doc files before auditing and archiving. The commit helper runs git add .; use it only after confirming the tree contains no unrelated changes.

Keep commits reviewable. Do not discard unrelated work or rewrite established public history without explicit user authorization. Preserve artwork and provenance. Release/AppImage builds belong in Docker on Linux; weights and optional engines are provisioned in user data, not bundled.

Run only tests and fixtures relevant to the change. Do not run the full suite by default; broaden testing only when a failure or issue needs debugging. For UI repairs, exercise the affected layouts with varied content, themes and relevant responsive/localized states, and inspect the screenshots.

Core is the fixed Cognition Matrix list name. Secondary and Tertiary are freely renameable. Mandatory harness instructions remain present when editable personality/prompt preferences change. Native resource, revision, approval and live profile checks must remain enforced.

Still backgrounds are independent from theme and background AI. Keep them pointer-transparent, offer persisted blur/strength controls, and preserve bounded imported images in backups. Animated backgrounds are withdrawn and explicitly deferred; do not reintegrate without a new user request. Pause AI controls automatic tasks/memory, not decorative imagery or foreground chat.

Context-length testing remains deferred. Token-overhead testing/estimation is not queued and must not be resumed.

Original code is GPL-3.0-only. Preserve full local license text and third-party notices. Public distribution requires an exact Linux binary/license/source audit and complete corresponding source matching the binary, including required dependencies and build scripts. See docs/RELEASE_CHECKLIST.md.
