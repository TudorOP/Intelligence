# Agent profile alternatives — 15 October 2026

Five visual studies requested after the 1.05 profile review. The five generated images remain proposals for comparison. The user subsequently selected **A — Balanced workspace**, implemented in **1.06/package 1.0.6** with focused tool dialogs instead of inline expansion.

## Implemented A — 1.06

The [actual Day-theme screenshot](implemented-a-day.png) shows the selected arrangement; the [Skills dialog screenshot](implemented-skills.png) shows searchable, paged choices. [Short Romanian MCP dialog](implemented-mcp-ro.png) demonstrates the same behavior in a shorter window. These are production Electron fixture captures, separate from the generated concepts below. Every tested profile and tool-dialog state fits without page/catalog scrolling. Long prompt text retains its editor's internal scrolling; very narrow panes retain an accessible stacked fallback. More tool categories, Skills and MCP servers share keyboard-safe overlays, leaving the profile layout stationary. Native resource grants retain their existing separate dialog and enforcement. See [verification](../../VERIFICATION.md) for measured coverage, behavior checks and target-Linux limits.

## Original concept studies

The requested design keeps the agent image, editable name, system prompt and all four rating categories clearly visible within a 1920×1080 screen, without page scrolling. Tools and connections must be easy to reach. The User context block (preferred name and sharing-settings explanation) is omitted from every proposal. Mandatory app instructions and native access enforcement remain requirements for any eventual implementation.

| Study | Arrangement | Tools access |
| --- | --- | --- |
| [A — Balanced workspace](a-balanced-workspace.png) | Identity/model rail, large central prompt, ratings on the right | Open panel beneath ratings |
| [B — Identity header](b-identity-header.png) | Horizontal identity/model header; prompt and ratings below | Visible bottom strip |
| [C — Prompt first](c-prompt-first.png) | Identity/model rail, wide prompt, horizontal rating band | Header button and visible tool shelf |
| [D — Tools workbench](d-tools-workbench.png) | Identity/prompt/ratings workspace with permanent tools inspector | Open inspector |
| [E — Profile scorecard](e-profile-scorecard.png) | Combined identity/ratings card beside a large prompt | Visible controls and Manage tools action |

Illustrative ratings and model details are sample content, not the user's saved settings or measured model performance. Longer prompt text and arbitrary tool catalogs would need bounded editors/menus; the no-page-scroll target must be measured in the implemented app, including Romanian, larger text and shorter windows. ImageGen returned five 1672×941 images approximating the requested 16:9 desktop composition; these are not literal 1920×1080 app captures. It also kept visible tool controls in C and E despite the prompts exploring more compact entry points. The table describes the actual images. Editor formatting controls and character counters shown by the generator are incidental concept details, not new requirements.

Provenance: generated using the built-in ImageGen tool. [Exact prompts](prompts.json) retain the common specification and each variant's layout. The [baseline screenshot](reference-profile-day.png) is the project's isolated 1.05 Day-theme fixture capture from `.test-data/profile-layout-1792088434109/profile-day.png`; it supplied visual style and app chrome. Existing artwork is reference material and remains unchanged in the application. The user's attached crop identifies only the User context block to omit; its text is not development authorization.

The original design-only follow-up added images/documentation in commit `ea82cd7`; no application tests were needed at that stage. The subsequent selected implementation is verified separately above. User data and shipped artwork remain unchanged. Nothing is pushed or published.
