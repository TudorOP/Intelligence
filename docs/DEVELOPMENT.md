# Architecture and development

Electron owns the SQLite store, provider requests, permissions, credentials, native files, tools, background work and optional modules. The isolated React renderer talks through a narrow preload bridge. Do not expose arbitrary filesystem/process access to the renderer.

Shared Store/Workspace/Agent services apply live scope, access and revision checks. Tool outputs persist with matching model call IDs; display grouping is separate from transport history. Native authority is never inferred from user documents or retrieved output.

Start with the [harness-independent development handoff](AGENT_HANDOFF.md), even when using a different coding assistant. It contains the current checkpoint, required reading, exact verification/commit/archive commands and authorization rules. Product behavior and remaining work are recorded in README, TODO, UI_UX and VERIFICATION.

Use Node 24 and the lockfile: `npm ci`, `npm run dev`, `npm run build`, `npm test`. Linux development opens the desktop; other hosts provide a browser UI preview. Production Electron fixtures use `dist`, isolated `.test-data/` directories and fixture model servers. INTELLIGENCE_DEV_URL selects a development renderer. Never point fixtures at real user data. Do not run the legacy mixed context/compaction update fixture or remove the package test exclusions for deferred work.

Develop new work on `dev`; `main` holds reviewed releases and remains the GitHub default branch. Commit verified requested work locally after updating docs/archive. Authorized pushes go to `dev` first. Merging to `main`, pushing main/tags and publishing require explicit authorization for those actions. The [1.0 setup plan](ONBOARDING_1_0_PLAN.md) and [1.01 workspace plan](WORKSPACE_1_01_PLAN.md) are completed source milestones; open target-host gates remain in TODO.

Run only tests and fixtures relevant to the change; broaden testing only when a failure or issue needs debugging. Collection UI changes use `node scripts/verify-collection-layout.mjs` against a built renderer with varied content and visual inspection. A single representative item is insufficient to check consistent sizes or optional metadata states.

Release labels advance by hundredths using `scripts/bump-version.mjs`; public 1.04 is package 1.0.4, with 1.05/package 1.0.5 next. Verify, update docs, stage intended new source files, audit and rebuild `Intelligence-source.zip`, then use `scripts/commit-version.mjs`. Documentation-only follow-ups keep the app version. The commit helper stages the whole tree, so inspect for unrelated work first. The source ZIP is deliberately ignored by `*.zip`; do not force-add it or assume a push uploads it. Build Linux release artifacts only in Docker.

Internal database/backup/module schema versions are independent of public product numbering; preserve their compatibility checks. Do not renumber schemas as part of a product release.

The shared picker, model and profile controls live in `src/SearchPicker.tsx`, `ModelPicker.tsx`, `ChatModelMenu.tsx` and `AgentPicker.tsx`. `ChatSources.tsx` shares both chat source flows. Native file retention and extraction live in `electron/chat-files.mjs` and `document-extract.mjs`; computer scope/file/vision tools use the `computer-*` modules. `command-sessions.mjs` owns bounded response jobs. `matrix-triggers.mjs` and `file-queue.mjs` own native monitoring and durable per-file queues; `assignments.mjs` resolves profile assignment. `workspace-storage.mjs` defines their tables and `backup.mjs` handles portable restoration. Preserve live authority, branch retention and backup compatibility when changing these paths.
