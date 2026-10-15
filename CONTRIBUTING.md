# Contributing to Intelligence

Intelligence is a personal AI harness for non-technical people. Prefer understandable workflows, consistent controls and useful explanations. Keep Linux as the release target, English/Romanian UI, user-authored content and the native permission/revision/approval boundaries.

Read README.md, TODO.md, UI_UX.md and AGENTS.md before changing the application. Develop new work on dev; main holds reviewed releases and remains the default branch. Push to dev first only when authorized. Merging to main and publishing require separate explicit requests. Install dependencies with npm ci, run npm run dev, then verify with npm test and npm run build. Desktop fixtures use isolated .test-data directories; never point them at real user data. Run node scripts/verify-source.mjs before sharing source.

The [development handoff](docs/AGENT_HANDOFF.md) provides the same workflow for any coding harness or agent, including local commits, versioning and source archive regeneration. Local commit preparation does not authorize remote actions. Source ZIPs remain ignored; refresh the local archive after verified source/doc work rather than force-adding it to Git.

For a bug report, describe the steps, expected result, actual result, app version, OS and relevant provider/model. Smaller-model tool failures are useful reports. Share minimal, sanitized examples; omit API keys, private conversations, database files, backups, model weights and downloaded engines. Use private reporting for security issues as described in SECURITY.md.

Code and original project assets use GPL-3.0-only. Contributions must be compatible with those terms. Preserve existing copyright, third-party licenses, artwork attribution and provenance. Identify the source and license of new dependencies or assets. Do not add credentials, optional runtime downloads or user data to Git.

Linux AppImage packaging runs in Docker. A source change is not a binary release: target-host checks, exact dependency/content notices and matching corresponding source remain required before distributing application builds. See docs/RELEASE_CHECKLIST.md.
