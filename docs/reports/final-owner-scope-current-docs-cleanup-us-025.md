# Report: US-025 Current Docs and Help Cleanup

**Date:** 2026-06-01  
**Scope:** current docs, glossary, built-in skills, and user-facing help text for the final one-app-space model.

## Result

Current canonical docs now describe Pibo as one app space after login. Auth remains an access gate and does not create product visibility, routing, workspace, job-control, read-state, or write-location partitions.

## Archived historical docs

The following superseded docs taught older account-partition or personal-target behavior and were moved under `docs/legacy/`:

- `docs/plans/no-owner-scope-shared-app-umbauplan-2026-05-28.md`
- `docs/plans/cron-jobs-implementation-plan.md`
- `docs/plans/2026-05-18-observer-gated-chat-streaming-implementation-plan.md`
- `docs/plans/signals-reliability-fix-plan-2026-05-19.md`
- `docs/specs/changes/shared-app-no-owner-scope/`
- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/`
- `docs/specs/changes/web-annotations-plugin/`
- `docs/specs/changes/compute-browser-resource-lifecycle/`
- `docs/specs/changes/extensible-ralph-stop-conditions/`
- `docs/specs/changes/ink-cli-session-ui/`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/`
- `docs/specs/changes/pibo-workflow-system-v1/`
- `docs/specs/changes/pibo-workflow-ui-authoring-v2/`
- `docs/specs/changes/context-build-inspector/`
- selected historical coverage reports under `docs/specs/coverage/`.

## Updated current materials

- `GLOSSARY.md` now defines the removed historical storage concept as non-active behavior and directs remaining references to historical docs or final cutover evidence.
- Current capability and project docs were rewritten away from old partition, membership, and personal-target wording.
- `skills/builtin/ralph-loop/SKILL.md` now uses app-global Ralph commands with `--room` or default targets, and no longer teaches partition flags.
- `skills/builtin/web-annotations/SKILL.md` now describes annotations as app resources keyed by Pibo Session/resource metadata.
- `src/tools/guides.ts` Ralph guide now describes app-global jobs and `--default-chat`.

## Reviewed temporary allowlist

The docs search gate allows only:

1. `docs/legacy/**` historical material;
2. the final-removal implementation docs that are the active Ralph batch record; and
3. the isolated final app-space cutover migration module.

The remaining current-doc matches are limited to these final-removal implementation files:

- `docs/plans/final-owner-scope-removal-umbauplan-2026-05-31.md`
- `docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal-prd.md`
- `docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal.prd.json`

These files discuss removed historical terms as migration/removal evidence, not active behavior. After the manual cutover and archival policy is chosen, shrink the search-gate allowlist again.

## Docker evidence

```bash
node scripts/legacy-product-vocabulary-gate.mjs \
  --roots GLOSSARY.md,docs/project,docs/specs,docs/plans,skills,src/tools/guides.ts \
  --json
```

Result in the Docker worker with fresh `PIBO_HOME`:

- Failures: 0
- Allowed matches: 511
- Scanned files: 180
- Allowed files: only the three final-removal implementation docs listed above.

No host database, host gateway, deploy, or production operation was touched.
