# Intelligence 1.02 — verification

The 1.02 update repairs appearance/sharing spacing, consolidates access controls, balances agent profiles, contains model-picker scrolling and normalizes Chat artwork across themes. It includes a full UI review and clearer secondary text colors. This is local source verification on `dev`; no push/publication or Linux binary build was performed.

## 1.02 results — 15 October 2026

All **232 enabled backend checks** passed during implementation, retaining the package script's deferred context/compaction exclusions. TypeScript and the final production renderer build pass. The four appearance/release-version checks also passed after the 1.02 bump. Build diagnostics retain the large-chunk and upstream Tiptap module-directive warnings.

The final production Electron UI fixture passed **502 captures** with `node scripts/verify-ui-repairs.mjs --states`, plus **132 captures** with `--supplemental`. Both used the same fixed 1.02 renderer and isolated data, with no renderer errors or horizontal overflow in the measured surfaces. These counts include repeated focused/responsive checks, not 634 unique screens. The [review evidence](design/ui-repairs-2026-10-15/REVIEW.md) maps the coverage across all ten themes. Full-size defect/responsive captures and comparison sheets were inspected for layout, spacing, typography, readable controls, artwork proportions and theme consistency.

The fixture verifies matching 520×248.39 CSS-pixel Chat artwork bounds in all themes at 1920×1080; Autumn previously used 660×314.55. It checks a 360-plus-model catalog in both chats, clipped/scrolled choices, keyboard focus visibility/Escape restoration, empty search, long model names and unavailable-provider status. It exercises grant add/revoke, confirms global suspension preserves permanent grants, checks ten unique tool categories and saves the skill-creation preference. Primary/secondary/small-label text tokens meet a measured 4.5:1 contrast against base, surface, sidebar and hover colors in every theme. This token check does not establish accessibility for every custom accent, artwork or device.

The final theme/background fixture passes 20 captures (`node scripts/verify-themes.mjs`), including independent artwork/blur, imported-image persistence, Pause AI, larger/shorter windows and Romanian. Settings (27 captures), profiles, onboarding (17 captures, including real native approvals/revocation) and workspace/automation (11 captures) fixtures passed during implementation. Fixture selectors were updated to open the new resource/computer disclosures before checking their existing behavior. No native permission service was changed.

Successful local artifacts are retained under `.test-data/`: `ui-repairs-after-1792081516478` (502), `ui-repairs-after-1792081814009` (132), `ui-polish-1792081516524` (20), `settings-1792080891999`, `profiles-1792080892017`, `onboarding-1792081123748` and `workspace-automation-1792080973300`. The pre-repair comparison is `ui-repairs-before-1792080669048` (18). Generated screenshots/results/comparison sheets stay ignored; the six original references remain tracked. The audited local source ZIP is refreshed after staging the new fixture/review document.

During verification, the theme fixture detected a 7 px collapsed Look & feel overrun; reducing the disclosure's internal padding fixed it while keeping its 24 px outer gap. Early captures could catch a lazy section before loading; the fixture now waits for the section fallback to disappear and deliberately opens shelf/board views. A run interrupted by rebuilding `dist` lost a lazy chunk; it was discarded and repeated against the fixed build. Earlier fixture development failures are not acceptance evidence.

These checks run on Windows. Linux compositor/font/scaling/sandbox/tray checks, actual providers/models and optional device/engine workflows remain open target-host acceptance. The full Linux binary/license/corresponding-source audit is still required before distribution. No context-length benchmark, token-overhead work, AppImage build, push, merge or publication was performed.

## 1.01 results

All **232 enabled backend checks** pass. TypeScript and the production renderer build pass; the existing large-chunk warning remains. The new workspace suite covers assignment migration, window bounds, file-scope and symlink checks, live revocation, stale file revisions, ephemeral image reads, conversation/branch retention, actual backup restoration, managed-command ownership/cleanup and durable file arrivals during active work and after restart. Restored computer grants require review; interrupted queue entries require attention.

The production Electron workspace fixture passes 11 captures with actual preload/IPC/SQLite and local model responses: compact searchable pickers, profile assignments, source retention, direct image messages, computer permissions, inbox setup, short windows and Romanian. Onboarding passes 17 captures including native permission requests in both chats; Settings passes 27 captures. Profiles, chat/memory controls, Matrix and agent-control fixtures also pass. Provider-qualified model choices preserve duplicate model names across providers; disconnection stops active work. Matrix verification includes native file/image/report tools, ASAR document parsing and task triggers. Representative picker/source/access screens were visually inspected. No renderer errors or horizontal overflow were reported by these fixtures.

The implementation source audit passed with 930 files and 442 complete indexed notices. The subsequent documentation-only handoff update adds one tracked guide (931 files total), checks local Markdown links/workflow commands and repeats the source/archive audit. Application tests above describe the implementation pass and are not claimed as rerun for documentation edits. Intelligence-source.zip is refreshed from the audited tracked source; archives stay ignored by Git. Artwork, original translations, user-authored content and historical release records are preserved, with no optional runtime/model/data/credential artifacts.

These checks ran on Windows with isolated fixture data. Actual Linux shell execution/process-group cancellation, desktop/window restoration across Wayland/X11, live providers and real download workflows remain target-host acceptance checks. Inbox readiness is a size/mtime stability heuristic, not a guarantee that another program has closed a file. Monitoring requires the application to run, including in its tray; startup/resume reconciles missed files. Command jobs end with their response/run; persistent shell state and a standalone monitoring service remain deferred. Context-length benchmarking and token-overhead work remain excluded. No binary was built, pushed or published.

## UI repair planning history — 15 October 2026

The [queued repair checklist](design/ui-repairs-2026-10-15/README.md) records the six user-supplied defect screenshots, original feedback, affected components and acceptance checks. All six screenshots were copied unchanged and compared against their originals with SHA-256. The feedback text is preserved with its extra trailing blank line removed for the whitespace check. Local Markdown links, all six embedded PNG references, pending status and unchanged package version 1.0.1 were checked. The tracked-source and archive audits were repeated after staging the new references; the ignored local source ZIP includes them.

At that planning checkpoint, this was documentation and visual context only: spacing, access consolidation, agent layout and picker overflow remained unfixed. Application tests were not rerun for that documentation-only work. The subsequent authorized implementation and fresh evidence are recorded in the 1.02 results above.

The checklist was then extended to require a full UI pass across every screen and all ten themes, including reproduction of the reported larger Chat image in Autumn under matched viewport/scale conditions. That documentation follow-up checked local links and source/archive contents only, retaining version 1.01/package 1.0.1 until application implementation began.

## 1.0 baseline

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

| Measure                                            | Cleanup baseline |             1.0 |
| -------------------------------------------------- | ---------------: | --------------: |
| Median startup, two runs each                      |         878.5 ms |        857.5 ms |
| Median summed idle process working sets            |        396.9 MiB |       394.8 MiB |
| Median Settings DOM/layout commit, ten probes each |           3.8 ms |         4.15 ms |
| Total production JavaScript, including lazy chunks |  1,391,965 bytes | 1,470,922 bytes |
| Entry and shared JSX chunks combined               |    756,068 bytes |   731,741 bytes |

The full JavaScript output grows by 78,957 bytes (5.7%); setup, Settings, lessons and the selected guide language load on demand. The initial entry/shared JSX output shrinks by 24,327 bytes. Idle process CPU samples stayed below 0.14% in both builds; warmed Settings working sets were approximately 413–415 MiB. These samples show no material startup/idle regression on this machine, but two runs per build do not establish a statistical guarantee. Working sets include resident shared code and are not a heap measurement. The DOM/layout probe does not measure final paint; Playwright click wall times include hidden-window scheduling and are not treated as user interaction latency.

Reproduce with node scripts/verify-performance.mjs LABEL [APPLICATION_ROOT] after building each checkout. Raw metrics remain in ignored .test-data/performance-\* directories and are included in the separate screenshot review archive. Existing real chat/local-server and renderer lifecycle fixtures pass; real-model throughput, Linux compositor behavior and target hardware remain acceptance limits below.

## Acceptance limits

Fixture responses verify harness behavior and deliberately wrong tool selections; they do not establish live Qwen/Gemma or other model reasoning quality. Real providers, credentials, models, remote MCP servers, speech/ZIM engines and devices need target-host acceptance. MCP setup supports stdio and Streamable HTTP with existing runtimes; OAuth/secret entry and dependency installation are separate user-managed actions. Restricted profiles cannot expand their own connection whitelist.

Linux Docker/AppImage, regular-user runtime, Wayland/X11/scaling/audio/device checks and the exact binary/license/corresponding-source audit remain release gates. Source verification does not establish binary release readiness. npm audit reports eight moderate findings in the electron-builder development dependency chain (zero high or critical findings); review them before packaging rather than applying a forced dependency change.
