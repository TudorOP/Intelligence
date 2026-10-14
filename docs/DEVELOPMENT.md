# Architecture and development

Electron owns the SQLite store, provider requests, permissions, credentials, native files, tools, background work and optional modules. The isolated React renderer talks through a narrow preload bridge. Do not expose arbitrary filesystem/process access to the renderer.

Shared Store/Workspace/Agent services apply live scope, access and revision checks. Tool outputs persist with matching model call IDs; display grouping is separate from transport history. Native authority is never inferred from user documents or retrieved output.

Node development: npm ci, npm run dev, npm run build, npm test. Desktop verification scripts use isolated data and fixture model servers. INTELLIGENCE_DEV_URL can select the development renderer; production fixtures use dist. Test/cache/release/credential files are excluded from source archives.

Develop new work on `dev`; `main` holds reviewed releases and remains the GitHub default branch. Authorized pushes go to `dev` first. Merging to `main`, pushing a release and publishing binaries require explicit user requests. See [the proposed 1.0 setup plan](ONBOARDING_1_0_PLAN.md) for the next review scope.

Release labels advance by hundredths. releaseLabel maps package 0.9.0 to 0.9 and 0.9.1 to 0.91; nextRelease carries through 0.99 to 1.0. Run scripts/bump-version.mjs, verify, update docs/archive, then scripts/commit-version.mjs. Build Linux artifacts only in Docker. Never push/publish without an explicit request.

Internal database/backup/module schema versions are independent of public product numbering; preserve their compatibility checks. Do not renumber schemas as part of a product release.
