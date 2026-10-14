# Intelligence 0.94 — verification

The backend suite passes all **207 enabled checks**, and the TypeScript/production renderer build passes in this checkout. The production Electron desktop smoke fixture also passes with isolated data and no renderer runtime errors. Reproduce source verification with npm ci, npm test and npm run build. Context-length benchmarks remain deferred and token-overhead work is not queued.

Source-publication checks also pass: 880 tracked files, 442 indexed complete notices, matching GPL copies, preserved original artwork/provenance and no optional runtime/model/data/credential artifacts. Three regression checks reject extra initial history, force-added private/download files, disguised model data, key-like text and missing notices. GitHub CI runs the same source guard, backend suite and renderer build with read-only repository permissions.

## Automated coverage

Backend checks cover resource permissions, live profile scopes, revisions, backups, providers, tool calls, memory, tasks, Matrix work, scheduling, optional modules, Vault files and MCP connections. Routing checks distinguish Tasks/Kanban from the agent-only Cognition Matrix, including renamed or colliding titles. They reject document bodies on containers and Vault folders before effects, read fresh Vault disk content, verify durable note creation and preserve chapter text when copying it into a note.

MCP checks cover native setup review even under Full Access, denial without writes/launch, stale configurations, restricted profiles, revocation during handshake, safe endpoint/argument validation and preserved skill exclusions. A local Streamable HTTP server exercises the actual Connections client through initialize, discovery and read-only echo.

After a production renderer build, run node scripts/verify-harness-routing.mjs, node scripts/verify-agent-controls.mjs, npm run test:chat-memory-order and npm run test:desktop. These Electron fixtures use actual preload/IPC/SQLite with local model responses and harmless local MCP servers in isolated .test-data directories.

The routing fixture observes a real child note during a running response, verifies persistence after Stop/reload, renders saved chapter Markdown and exercises preserved/idempotent copying. It launches a local stdio server only after native setup review, discovers and invokes echo, disconnects after review and checks the bundled MCP setup skill.

Agent-control fixtures cover contextual task actions, provider selection/reload/disconnection, configurable tool rounds and both chat steering surfaces. Chat/memory/list/theme fixtures cover composer geometry, list ordering, memory sources and all ten themes. Production smoke covers Markdown/autosave, tasks/recurrence/links, memory search, Trash, ASAR tray-icon decoding and reload persistence. Responsive/localized fixtures cover English/Romanian and 1920×1080, 1366×768, 2560×1440 and 3440×1440. Inspect representative screens and check renderer errors and horizontal overflow.

Generated logs, screenshots and fixture databases are ignored and excluded from source distribution. Rebuild the source ZIP with scripts/archive-source.ps1; preserve licenses, artwork, lockfiles and source/build scripts.

## Acceptance limits

Fixture responses verify harness behavior and deliberately wrong tool selections; they do not establish live Qwen/Gemma or other model reasoning quality. Real providers, credentials, models, remote MCP servers, speech/ZIM engines and devices need target-host acceptance. MCP setup supports stdio and Streamable HTTP with existing runtimes; OAuth/secret entry and dependency installation are separate user-managed actions. Restricted profiles cannot expand their own connection whitelist.

Linux Docker/AppImage, regular-user runtime, Wayland/X11/scaling/audio/device checks and the exact binary/license/corresponding-source audit remain release gates. Source verification does not establish binary release readiness. npm audit reports eight moderate findings in the electron-builder development dependency chain (zero high or critical findings); review them before packaging rather than applying a forced dependency change.
