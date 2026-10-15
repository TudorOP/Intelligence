# Release checklist

## Source publication

Follow [AGENT_HANDOFF.md](AGENT_HANDOFF.md) for local preparation and authorization boundaries. An implementation request authorizes verified local commits; pushes, main merges, tags, archive uploads and publication require the user's explicit authorization for those actions.

- Run node scripts/verify-source.mjs and review the complete tracked inventory, credentials scan, notices and artwork provenance.
- Keep optional models/voices/engines, user data, build outputs, dependencies and archives outside Git; preserve installer/source and license metadata.
- Verify README, contribution/security guidance, funding link and CI. Publish only reviewed commits with explicit authorization.
- Source publication does not authorize distributing unverified application binaries.

## Application binary release

- Verify version/lock consistency, TypeScript, renderer build, enabled backend regressions and applicable desktop fixtures.
- Inspect Chat, writing, collections, tasks/Matrix, Settings, tooltips/menus/dialogs and background controls at 1920×1080, larger and shorter sizes, text scaling, all themes and Romanian.
- Exercise keyboard/focus/Escape, Pause AI, still-image blur/strength, imported image persistence, backup restoration, cancellation, live permissions and stale revisions. Retired animation settings must remain inert.
- Measure still-image compositor/blur and model/engine resources on the target Linux host. Keep fixtures separate from actual provider/model/device acceptance. Decorative animation reintegration is deferred.
- Build the AppImage in Linux Docker, then run it as a regular Linux desktop user and verify sandbox, Wayland/X11, tray, packaging resources and native engines.
- Review exact binary/dependency/model/content licenses; ship complete notices and offer complete corresponding source matching each binary.
- Refresh README, CHANGELOG, TODO, verification and source archive; commit locally. Upload only with an explicit user request.

Stage intended new source/doc files before the tracked-source audit and archive. Rebuild the ignored local ZIP with scripts/archive-source.ps1; do not force-add archives or assume a Git push uploads them. Inspect the whole tree before scripts/commit-version.mjs because it runs git add . before the commit.

Normal application release labels increase by 0.01 through scripts/bump-version.mjs. Documentation-only follow-ups retain the app version unless a new release is requested. Context-length benchmarks are deferred. Token-overhead work is not queued.
