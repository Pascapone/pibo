# US-027 Migrated Sandbox Docker Validation

**Date:** 2026-06-01  
**Worker:** `pibo-dev-final-owner-scope-removal-ralph`  
**Migrated copy:** `/workspace/.tmp/us027-migrated-home`  
**Backup source for apply:** `/workspace/.pibo/ralph-migration-sandbox`

## Scope

US-027 validated a migrated copy of the historical sandbox through Docker-only user paths. The original host `/root/.pibo` tree, host Dev/Production gateways, deploy scripts, Production data, and PR creation were not touched.

## Migration apply on copied sandbox

The Docker worker copied the migration sandbox to `/workspace/.tmp/us027-migrated-home` and ran final cutover apply against that copy only:

```bash
cp -aL "$PIBO_MIGRATION_SANDBOX_HOME" /workspace/.tmp/us027-migrated-home
node dist/bin/pibo.js data final-cutover apply \
  --root /workspace/.tmp/us027-migrated-home \
  --backup "$PIBO_MIGRATION_SANDBOX_HOME" \
  --json > /workspace/.tmp/us027-final-cutover-apply.json
```

Result summary:

- `appliedDatabases`: 6
- post-apply totals: 8 databases, 0 affected databases, 0 legacy columns, 0 legacy indexes, 0 legacy rows, 0 conflict groups, 0 unresolved blockers
- backup/post-apply quick checks recorded by apply: six `ok` results
- migration report: `/workspace/.tmp/us027-migrated-home/migration-reports/final-cutover-apply-2026-06-01T10-14-34-357Z.json`

A read-only schema scan over the migrated copy found no forbidden product columns or tables:

- columns checked: `owner_scope`, `principal_id`
- tables checked: `room_members`, `principal_session_stats`, `principal_room_stats`
- result: zero violations across `auth.sqlite`, `chat-agents.sqlite`, `context-files/context-files.sqlite`, `pibo-cron.sqlite`, `pibo-events.sqlite`, `pibo-ralph.sqlite`, `pibo.sqlite`, `web-annotations.sqlite`, and `web-projects.sqlite`

## Chat Web/API validation

A worker-local dev-auth web gateway was started with:

```bash
PIBO_HOME=/workspace/.tmp/us027-migrated-home \
node -e "import('./dist/gateway/web.js').then(m => m.runWebGatewayServer({ devAuth: true, web: { host: '127.0.0.1', port: 4791 } }))"
```

The validation script logged in through dev auth, fetched `/apps/chat/`, and recursively asserted every JSON payload had no `ownerScope`, `owner_scope`, `principalId`, or `principal_id` keys.

Covered paths:

- Chat bootstrap, room list/sidebar data, direct session open, room detail, session creation, and provider-free streaming fixture send path
- Agent Designer list/create
- Projects list/create/bootstrap
- Workflow catalog and workflow-version picker
- Ralph list/create/get/runs with `default-chat` target
- Cron list/create/get/runs with `default-chat` target
- Web Annotations same-origin binding, overlay submission, and app-scope annotation list

Result summary from `/workspace/.tmp/us027-artifacts/web-api-summary.json`:

```json
{
  "defaultRooms": 34,
  "defaultSessions": 5,
  "existingAgents": 3,
  "existingProjects": 0,
  "existingRalphJobs": 11,
  "existingCronJobs": 1,
  "createdAgent": "us027-agent-mpv1ylsh",
  "createdProject": "prj_0540c514-d7dc-45d5-b7b9-b0e8eba6db9b",
  "createdRalphJob": "ralph_653c7d10-992a-4460-a7e6-609213e7da93",
  "createdCronJob": "cron_0ae910eb-6852-46a9-b684-8a7b9c047344",
  "createdAnnotation": "ann_07b7c997-04f1-496e-b385-eb53f2d6faac"
}
```

The worker-local gateway was stopped after validation.

## CLI and PTY validation

Safe CLI checks ran with `PIBO_HOME=/workspace/.tmp/us027-migrated-home`:

```bash
node dist/bin/pibo.js ralph add --default-chat --profile base --prompt "US027 Ralph CLI validation" --name "US027 Ralph CLI" --json
node dist/bin/pibo.js ralph list --json
node dist/bin/pibo.js ralph runs --json
node dist/bin/pibo.js cron add --default-chat --agent base --prompt "US027 Cron CLI validation" --name "US027 Cron CLI" --at 2030-06-01T00:00:00.000Z --disabled --json
node dist/bin/pibo.js cron list --json
```

All JSON outputs parsed successfully and recursive checks found no owner/principal keys. Help checks for `pibo ralph`, `pibo cron add`, and `pibo tui:sessions` found no `--owner-scope`, `PIBO_OWNER_SCOPE`, `--personal`, `--principal-id`, `ownerScope`, `principalId`, personal-target, or Personal Chat wording.

Real PTY-backed TUI validation passed inside Docker:

```bash
node scripts/ink-cli-v2-pty-smoke.mjs \
  --scenario room-session-message \
  --artifact-root /workspace/.tmp/us027-pty
```

The PTY flow selected a room, created a session, sent `Smoke message`, received `Smoke assistant reply`, and observed `Message sent` without an owner picker. The smoke script uses its own deterministic PTY fixture home under `/workspace/.tmp/us027-pty`.

## Typecheck

```bash
.pibo/ralph-worker.sh 'npm run typecheck'
```

Result: passed.

## Safety confirmation

- Migration apply targeted only `/workspace/.tmp/us027-migrated-home`, a Docker-local copy of the sandbox.
- Backup verification used `/workspace/.pibo/ralph-migration-sandbox`, the copied sandbox backup path.
- No command targeted or mutated `/root/.pibo`.
- No host Dev or Production gateway was restarted.
- No host deploy or Production deploy ran.
- No upstream PR was created.

## Follow-up

US-028 should document Docker-only deployment/gateway validation and the manual production cutover runbook. US-029 should run the final strict zero-regression search and full validation sweep.
