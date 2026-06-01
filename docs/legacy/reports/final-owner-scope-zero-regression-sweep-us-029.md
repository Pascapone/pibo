# US-029 Final Owner Scope Zero-Regression Sweep

**Date:** 2026-06-01  
**Worker:** `pibo-dev-final-owner-scope-removal-ralph`  
**Workspace:** `/workspace`  
**Fresh test home:** `/workspace/.pibo/ralph-test-home`

## Scope

US-029 ran the final Docker-only zero-regression sweep for active product Owner Scope artifacts. All runtime commands ran inside the dedicated Docker worker with `PIBO_HOME=/workspace/.pibo/ralph-test-home`. Host `/root/.pibo`, host Dev/Production gateways, deploy scripts, Production data, migration apply against host data, and PR creation were not touched.

## Cleanup before validation

The active-source gate found a few non-product but confusing active-source vocabulary matches. This story removed or renamed them before the final sweep:

- Removed the unused `ChatUnreadCountInput.principalId` type/export.
- Renamed technical in-memory runtime/run helper methods away from `getOwned` / `requireOwned` wording.
- Renamed the CLI legacy repair metadata key from `repairedFromOwnerScope` to `repairedFromLegacyScope`.
- Updated the compute smoke summary from the retired technical Docker label name to `holder` / `pibo.compute.holder`.
- Updated the Docker dev-auth skill text so it describes shared app access after auth, not data belonging to the dev identity.
- Tightened `npm run check:product-vocab` to scan active product roots by default (`src`, `packages`, `scripts`, `skills`, current docs/plans/specs) and leave test fixtures/negative assertions to `npm test`.

## Search gates

Command:

```bash
.pibo/ralph-worker.sh 'npm run --silent check:product-vocab -- --json > /workspace/.tmp/us029/product-vocab-final.json'
```

Result: passed.

```json
{
  "failures": 0,
  "allowed": 540,
  "scannedFiles": 683,
  "roots": ["src", "packages", "scripts", "skills", "docs/project", "docs/specs", "docs/plans"],
  "allowedPaths": [
    "docs/plans/final-owner-scope-removal-umbauplan-2026-05-31.md",
    "docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal-prd.md",
    "docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal.prd.json",
    "src/data/final-app-space-cutover-migration.ts"
  ]
}
```

Focused gate tests also passed:

```bash
.pibo/ralph-worker.sh 'node --test test/legacy-product-vocabulary-gate.test.mjs test/shared-app-artifact-search-gate.test.mjs'
```

Result: 9 tests passed, 0 failed.

## CLI help checks

A built-CLI help scan checked these commands for removed owner/principal options and wording:

- `pibo ralph --help`
- `pibo ralph add --help`
- `pibo cron --help`
- `pibo cron add --help`
- `pibo tui:sessions --help`
- `pibo data final-cutover --help`
- `pibo data final-cutover inspect --help`
- `pibo debug --help`
- `pibo debug session --help`

Result: all commands returned help and had zero hits for removed owner/principal terms. Summary artifact: `/workspace/.tmp/us029/help-summary.json`.

## Worker-local API/JSON payload checks

A worker-local dev-auth web gateway was started on `127.0.0.1:4792` with the fresh test home. The validation logged in through dev auth and recursively checked JSON keys for `ownerScope`, `owner_scope`, `principalId`, and `principal_id`.

Covered endpoints:

- `/api/chat/bootstrap`
- `/api/chat/agents`
- `/api/chat/projects`
- `/api/chat/projects/bootstrap`
- `/api/chat/workflows?includeArchived=true`
- `/api/chat/ralph/jobs?includeDisabled=true`
- `/api/chat/cron/jobs?includeDisabled=true`
- `/api/web-annotations?scope=app&piboSessionId=<selected-session>`

Result: all responses returned `200` and zero forbidden keys. Summary artifact: `/workspace/.tmp/us029/api-summary.json`.

## Full Docker validation

Commands:

```bash
.pibo/ralph-worker.sh 'npm run typecheck'
.pibo/ralph-worker.sh 'npm run build'
.pibo/ralph-worker.sh 'npm test'
```

Results:

- `npm run typecheck`: passed.
- `npm run build`: passed with only existing Vite chunk-size warnings.
- `npm test`: passed.

```text
tests 895
suites 4
pass 895
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 50535.072148
```

## Safety confirmation

- No command targeted or mutated `/root/.pibo`.
- No host Dev or Production gateway was restarted.
- No host deploy or Production deploy ran.
- No Production database migration or apply ran.
- No upstream PR was created.

## Follow-up

US-030 should prepare the final user-review handoff, PR-readiness materials, and production cutover review checkpoint without opening a PR or applying any real database migration.
