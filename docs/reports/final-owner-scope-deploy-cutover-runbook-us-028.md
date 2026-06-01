# US-028 Docker Deployment Validation and Manual Cutover Runbook

**Date:** 2026-06-01  
**Worker:** `pibo-dev-final-owner-scope-removal-ralph`  
**Fresh test home:** `/workspace/.pibo/ralph-test-home`  
**Worker web port:** container `4788`, host-mapped `4832`

## Scope

This report documents Docker-only validation and a future human-approved production cutover runbook. The Ralph loop did not deploy to host Dev or Production, did not restart host gateways, did not mutate `/root/.pibo`, and did not open a PR.

## Docker-only validation performed

All commands ran inside the Docker worker with `PIBO_HOME=/workspace/.pibo/ralph-test-home`.

```bash
.pibo/ralph-worker.sh 'npm run build >/tmp/us028-build.log && npm run typecheck >/tmp/us028-typecheck.log'
```

Result:

- `npm run build`: passed; only existing Vite chunk-size warnings.
- `npm run typecheck`: passed.

Worker-local web gateway start/restart validation used the built `dist/gateway/web.js` with dev auth and the worker web port:

```bash
PIBO_HOME=/workspace/.pibo/ralph-test-home \
node --input-type=module -e "const { runWebGatewayServer } = await import('./dist/gateway/web.js'); await runWebGatewayServer({ devAuth: true, web: { host: '0.0.0.0', port: 4788 } });"
```

Validation steps:

1. Start worker-local Chat Web gateway on container port `4788` / host port `4832`.
2. Log in through Docker dev auth at `/api/auth/sign-in/social`.
3. Fetch `/api/auth/session` and verify dev user access.
4. Fetch `/api/chat/bootstrap` and recursively assert no product owner/principal keys.
5. Stop the worker-local gateway process.
6. Start it again on the same worker port.
7. Repeat login and bootstrap checks.
8. Stop the worker-local gateway process.

Gateway validation summary from `/workspace/.tmp/us028-gateway/summary.json`:

```json
{
  "workerContainerPort": 4788,
  "hostMappedPort": 4832,
  "first": { "userId": "dev-user-001", "rooms": 1, "selectedSessionId": null },
  "second": { "userId": "dev-user-001", "rooms": 1, "selectedSessionId": null },
  "restarted": true
}
```

## Actions explicitly not performed

- No `./scripts/deploy-web-dev.sh` or `./scripts/deploy-web.sh` run.
- No `pibo gateway web restart`, `pibo gateway dev restart`, or host gateway command run.
- No host Dev deployment.
- No Production deployment.
- No migration inspect, dry-run, or apply against `/root/.pibo`.
- No Production database mutation.
- No upstream PR creation.

## Future manual production cutover runbook

Run this only after human review and explicit approval. The autonomous Ralph loop must stop before any real Production database migration or upstream PR creation.

### 1. Pre-approval checklist

- Review the final branch diff and validation reports.
- Confirm `npm run typecheck`, `npm run build`, `npm test`, search gates, migrated-sandbox validation, browser/API checks, and PTY checks passed in Docker.
- Confirm active sessions and operator availability for a rollback window.
- Decide whether the temporary final cutover migration module remains in the review PR or is deleted after approved cutover.
- Confirm no host/Production data has been changed by the Ralph loop.

### 2. PR review gate

- Prepare a PR from the dedicated branch after review approval.
- Do not open the upstream PR automatically from this Ralph loop.
- Include reports for fresh validation, migrated sandbox validation, search gates, and this runbook.

### 3. Production backup gate

After explicit approval and before mutation:

1. Quiesce or stop the Production gateway through the Pibo CLI only.
2. Take a fresh Production backup of every affected SQLite DB.
3. Verify each backup with `PRAGMA quick_check`.
4. Store the backup outside the target `.pibo` root.
5. Record backup path, checksums, and quick-check results.

### 4. Production dry-run gate

1. Run final cutover inspect against the approved Production root only after approval.
2. Run final cutover dry-run against the same root.
3. Review affected DBs, row counts, legacy columns/indexes, conflict groups, planned actions, and unresolved blockers.
4. Stop if any blocker or unexpected conflict appears.

### 5. Production apply gate

1. Require a verified backup path outside the target root.
2. Run final cutover apply only after a second explicit approval.
3. Verify per-database transaction results, row-count checks, and post-apply `PRAGMA quick_check`.
4. Save the generated migration report and rollback instructions.

### 6. Deploy/restart gate

1. Deploy the reviewed final code through the approved production deployment process.
2. Restart the Production gateway through the Pibo CLI only.
3. Use force restart only if explicitly approved at that time.

### 7. Post-cutover validation

Validate:

- Chat Web login, bootstrap, sidebar, direct session open, create session, provider-free send path where practical, archive/restore.
- Agent Designer list/create.
- Projects and workflow picker/bootstrap.
- Ralph and Cron list/create/get/runs.
- Web Annotations list/create where practical.
- CLI help and JSON output for Ralph, Cron, and TUI session flows.
- API/JSON payloads have no product owner/principal keys.
- Fresh schemas have no product owner/principal columns or membership/principal stats tables.

### 8. Rollback plan

If validation fails:

1. Stop/quiesce the Production gateway through the Pibo CLI.
2. Restore the verified backup files to the original relative paths under the Production `.pibo` root.
3. Redeploy the previous stable code version.
4. Restart the gateway through the Pibo CLI.
5. Run `PRAGMA quick_check` and minimal Chat Web/API smoke checks.
6. Preserve logs, migration report, and failed validation artifacts for incident review.

## Temporary migration module follow-up checklist

After an approved Production cutover and validation window, decide whether to remove the temporary cutover module in a follow-up change. If removal is chosen:

- Delete or archive `src/data/final-app-space-cutover-migration.ts` and migration-only tests.
- Remove final-removal implementation-doc allowlists from the vocabulary gate if those docs have been archived.
- Re-run the active-source/current-docs search gates with zero active exceptions.
- Re-run `npm run typecheck`, `npm run build`, and `npm test` in Docker.

## Review checkpoint

Code is moving toward review readiness, but this story is not the final handoff. US-029 must still run the final zero-regression sweep, and US-030 must prepare PR-readiness materials and stop for user review before PR creation or real cutover.
