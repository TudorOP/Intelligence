# Intelligence 1.02 — UI review evidence

This review implements the user-authorized checklist and preserves the original six screenshots and feedback. It uses the production Electron renderer, preload/IPC and isolated fixture data on Windows. Target-Linux compositor, device and live-provider acceptance remains separate.

## Repairs

| Area | Result |
| --- | --- |
| Icons & identity | A 24 px gap separates the disclosure from Background artwork. One title remains; app/tray/logo choices stay independent. |
| Sharing actions | Notebook sharing and Task sharing use an explicit 10 px gap and wrap within the available width. |
| Agent access | Workspace/memory switches share one card. Selected-agent policy stays visible; effective access, resource grants and computer controls expand when needed. Permanent and temporary grants remain revocable. |
| Agent profile | Independent columns keep ratings directly below identity. The layout responds to available workspace width; tool categories appear once. The skill-creation preference is now included in Save profile. |
| Model picker | Choices scroll within their own region. Search, status and the providers action remain separate; focused choices stay visible. Home/End still edit text in search. |
| Autumn artwork | Before: 660×314.55 CSS px at 1920×1080, versus 520×248.39 in the other nine themes. After: 520×248.39 in all ten. Original assets remain unchanged; the Autumn panorama retains contain sizing. |
| Theme text | Adjust secondary/small-label tokens within their palettes. Primary, secondary and small-label foregrounds meet the fixture's 4.5:1 check against base, surface, sidebar and hover colors in all ten themes. This does not establish contrast for every custom accent or artwork combination. |

## Coverage

Each row below is reviewed across Ink, Day, Night, Summer, Autumn, Winter Wonderland, Festive, Tech, Astral and Marble & gold. Captures compare layout, spacing, hierarchy, control geometry, artwork proportions and readable theme surfaces. Full-size checks supplement the comparison sheets for reported defects and responsive layouts.

| Surface group | Views |
| --- | --- |
| Conversations | Empty/populated Chat, assistant, long model catalog, empty search, long model name, unavailable-provider status, history, Add sources and command search |
| Writing | Notebook shelf, chapter overview, note/Markdown table, Vault document |
| Work | Projects and file browser, task board/detail, Calendar and event editor, Reports/list/reader/template gallery/editor, Matrix and expanded configuration |
| Agent | Profile library, identity/model/resources, ratings, tool categories, saved skill-creation preference, grant add/revoke and global suspension |
| Companion | Device overview, Memory and stored details, Skills, Connections |
| Settings | Profile, Look & feel/identity, models, chat preferences, search, optional modules, Agent access, background automation, Matrix and data |
| Setup/help | Six setup stages, written guide, lesson library, active lesson, licenses and Trash |

The fixture also captures 1366×768, 2560×1440, 1920×1080 at 125% text scale and Romanian at 1366×768. Existing Settings, profile, onboarding, workspace/automation and theme/background fixtures cover additional interaction, keyboard, localization, persistence, larger-window and independent-background behavior. No user database, provider key or personal file is used.

## Reproduce and retained artifacts

Build first, then keep `dist` unchanged while desktop fixtures run. Rebuilding under an open fixture invalidates lazy-import filenames and is not a valid acceptance run.

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/verify-ui-repairs.mjs --states
node scripts/verify-ui-repairs.mjs --supplemental
```

The default fixture checks the reported repairs and main screens/Settings. `--states` adds setup and common dialogs; `--supplemental` checks populated readers, expanded controls, long names and provider errors. `--focused` checks the repairs without the full screen loop. `--baseline` captures comparison data without asserting repaired geometry or contrast; run it against the pre-repair source/build if a fresh baseline is needed.

Every run writes PNG captures, geometry, effective palettes, measured Chat bounds and checks to its own ignored `.test-data/ui-repairs-*` directory. The original reference images beside the checklist remain tracked. Generated screenshots/results and comparison sheets stay local and are excluded from the source ZIP. Exact successful run directories, counts, commands and verification limits are recorded in `docs/VERIFICATION.md`.
