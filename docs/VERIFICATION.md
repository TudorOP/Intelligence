# Intelligence 1.0 — verification

The authorized 1.0 implementation follows a separately verified cleanup commit on dev. The six-stage setup, offline guide/lessons, inline provider help and reviewed agent access/configuration flows are implemented; this is local source preparation, not a published binary release.

The backend suite passes all **223 enabled checks**, and TypeScript plus the production renderer build pass. Context-length benchmarks remain deferred and token-overhead work is not queued. Reproduce source checks with npm ci, npm test and npm run build. The existing editor chunk warning remains; optional engines and model weights are not bundled.

The tracked-source audit passes with 910 files, 442 indexed complete notices, matching GPL copies and preserved original artwork/provenance. No optional runtime/model/data/credential artifacts are included. Three source-guard regression checks reject extra initial history, private/download artifacts, disguised model data, key-like text and missing notices. CI uses the same source guard, backend suite and renderer build with read-only repository permissions.

## Automated coverage

Backend checks cover resource permissions, live profile scopes, revisions, backups, providers, tool calls, memory, tasks, Matrix work, scheduling, optional modules, Vault files and MCP connections. Routing checks distinguish Tasks/Kanban from the agent-only Cognition Matrix, including renamed or colliding titles. They reject document bodies on containers and Vault folders before effects, read fresh Vault disk content, verify durable note creation and preserve chapter text when copying it into a note.

MCP checks cover native setup review even under Full Access, denial without writes/launch, stale configurations, restricted profiles, revocation during handshake, safe endpoint/argument validation and preserved skill exclusions. A local Streamable HTTP server exercises the actual Connections client through initialize, discovery and read-only echo.

After a production renderer build, run node scripts/verify-harness-routing.mjs, node scripts/verify-agent-controls.mjs, npm run test:chat-memory-order and npm run test:desktop. These Electron fixtures use actual preload/IPC/SQLite with local model responses and harmless local MCP servers in isolated .test-data directories.

The routing fixture observes a real child note during a running response, verifies persistence after Stop/reload, renders saved chapter Markdown and exercises preserved/idempotent copying. It launches a local stdio server only after native setup review, discovers and invokes echo, disconnects after review and checks the bundled MCP setup skill.

Agent-control fixtures cover contextual task actions, provider selection/reload/disconnection, configurable tool rounds and both chat steering surfaces. Chat/memory/list/theme fixtures cover composer geometry, list ordering, memory sources and all ten themes. Production smoke covers Markdown/autosave, tasks/recurrence/links, memory search, Trash, ASAR tray-icon decoding and reload persistence. Responsive/localized fixtures cover English/Romanian and 1920×1080, 1366×768, 2560×1440 and 3440×1440. Inspect representative screens and check renderer errors and horizontal overflow.

New native regressions cover stable setup validation, partial profile saves, exact temporary/per-agent grants, stale approvals, revocation, private inventory, native read-only/source checks, reviewed collection creation, narrowly allowlisted configuration, backup grant stripping and protected local tokens. New assistant replies retain resource/profile provenance; inaccessible sourced responses, reasoning and generated tool arguments are not replayed into later model requests, while the owner transcript stays intact. Saved memories retain private source permissions even when the model omits source IDs; conversation recall checks those sources too. Newly created resources can be proposed for access during their creating request, but still require native review. Permission changes invalidate cached run history; revocation of a source already in use stops the response. Already transmitted data cannot be withdrawn from the provider.

The onboarding fixture passes 17 real Electron captures covering six stages, inline model discovery/reply test, save/exit/reload without reopening, Settings return, completed review with lesson preservation, actual read permission in main/sidebar, permanent grant revocation, configuration review, 1366/2560/3440 layouts and Romanian. Settings passes 27 captures including ten sections, provider variants, port validation, six themes, 125% scaling and Romanian. All-app polish captures cover writing, collections, Tasks/Matrix, reports, Skills, Connections, Memory, Settings and responsive/localized dialogs. Notifications stack above selected-item actions; the fixture checks for overlap.

Applicable local desktop checks also cover profiles, comfort, large-workspace/Trash bounding, Vault, organization, Calendar/reports, optional modules/speech UI, provider search, icon ASAR decoding, Matrix scheduler wake/resource lifecycle and PDF/DOCX ASAR parsing. The 60-cycle renderer lifecycle pass retains bounded DOM/heap. Several old fixtures needed selectors updated for existing navigation/labels, provider-qualified model values and the production renderer; their semantic checks remain. The legacy update fixture mixes deferred context/compaction work and is excluded from final acceptance. The old startup comparison requires an obsolete baseline checkout; the new performance fixture provides the 0.94/1.0 comparison. Real consolidation is Linux-only and remains a target-host gate.

Generated logs, screenshots and fixture databases are ignored and excluded from source distribution. Rebuild the source ZIP with scripts/archive-source.ps1; preserve licenses, artwork, lockfiles and source/build scripts.

## Local performance comparison

The production Electron fixture compares the verified cleanup commit c8a2b90 (0.94) with 1.0 on the same Windows machine. Four isolated runs used baseline / 1.0 / 1.0 / baseline order, without other acceptance fixtures running. Each run opened Settings five times and recorded a separate DOM/layout commit probe. Closed setup/help features add no polling, background model requests or recurring timers.

| Measure | Cleanup baseline | 1.0 |
| --- | ---: | ---: |
| Median startup, two runs each | 878.5 ms | 857.5 ms |
| Median summed idle process working sets | 396.9 MiB | 394.8 MiB |
| Median Settings DOM/layout commit, ten probes each | 3.8 ms | 4.15 ms |
| Total production JavaScript, including lazy chunks | 1,391,965 bytes | 1,470,922 bytes |
| Entry and shared JSX chunks combined | 756,068 bytes | 731,741 bytes |

The full JavaScript output grows by 78,957 bytes (5.7%); setup, Settings, lessons and the selected guide language load on demand. The initial entry/shared JSX output shrinks by 24,327 bytes. Idle process CPU samples stayed below 0.14% in both builds; warmed Settings working sets were approximately 413–415 MiB. These samples show no material startup/idle regression on this machine, but two runs per build do not establish a statistical guarantee. Working sets include resident shared code and are not a heap measurement. The DOM/layout probe does not measure final paint; Playwright click wall times include hidden-window scheduling and are not treated as user interaction latency.

Reproduce with node scripts/verify-performance.mjs LABEL [APPLICATION_ROOT] after building each checkout. Raw metrics remain in ignored .test-data/performance-* directories and are included in the separate screenshot review archive. Existing real chat/local-server and renderer lifecycle fixtures pass; real-model throughput, Linux compositor behavior and target hardware remain acceptance limits below.

## Acceptance limits

Fixture responses verify harness behavior and deliberately wrong tool selections; they do not establish live Qwen/Gemma or other model reasoning quality. Real providers, credentials, models, remote MCP servers, speech/ZIM engines and devices need target-host acceptance. MCP setup supports stdio and Streamable HTTP with existing runtimes; OAuth/secret entry and dependency installation are separate user-managed actions. Restricted profiles cannot expand their own connection whitelist.

Linux Docker/AppImage, regular-user runtime, Wayland/X11/scaling/audio/device checks and the exact binary/license/corresponding-source audit remain release gates. Source verification does not establish binary release readiness. npm audit reports eight moderate findings in the electron-builder development dependency chain (zero high or critical findings); review them before packaging rather than applying a forced dependency change.
