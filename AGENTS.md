# Intelligence project handoff

Read README.md, TODO.md and UI_UX.md before starting. Main is the sole maintained branch. Target 1920×1080 first, support larger/shorter windows and preserve English/Romanian UI and user-authored content.

Release 0.94 uses package 0.9.4. Normal updates add 0.01 to the public label: 0.95, 0.96, etc. Use scripts/bump-version.mjs; it maps the public label to a valid semantic package version. After verification, update release docs and Intelligence-source.zip, then run scripts/commit-version.mjs for a local commit. Do not push or publish without an explicit user request.

Keep commits reviewable. Do not discard unrelated work or rewrite established public history without explicit user authorization. Preserve artwork and provenance. Release/AppImage builds belong in Docker on Linux; weights and optional engines are provisioned in user data, not bundled.

Core is the fixed Cognition Matrix list name. Secondary and Tertiary are freely renameable. Mandatory harness instructions remain present when editable personality/prompt preferences change. Native resource, revision, approval and live profile checks must remain enforced.

Still backgrounds are independent from theme and background AI. Keep them pointer-transparent, offer persisted blur/strength controls, and preserve bounded imported images in backups. Animated backgrounds are withdrawn and explicitly deferred; do not reintegrate without a new user request. Pause AI controls automatic tasks/memory, not decorative imagery or foreground chat.

Context-length testing remains deferred. Token-overhead testing/estimation is not queued and must not be resumed.

Original code is GPL-3.0-only. Preserve full local license text and third-party notices. Public distribution requires an exact Linux binary/license/source audit and complete corresponding source matching the binary, including required dependencies and build scripts. See docs/RELEASE_CHECKLIST.md.
