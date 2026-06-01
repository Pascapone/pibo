# US-018 Validation and Rollout Readiness Report

Date: 2026-05-30

## Status

US-018 is **complete** in this report revision. Docker validation, approved host Dev deploy/restart, real Ralph/Cron CLI checks, and authenticated Chat Web validation through the isolated Docker gateway/dev-auth flow all passed. Production deployment and Production data mutation remain separately gated and were not run.

## Completed Docker validation

All commands below were run through `.pibo/ralph-worker.sh` with `PIBO_HOME=/workspace/.pibo/ralph-sandbox` unless noted otherwise.

- `npm run typecheck` — passed.
- `npm run build` — passed; Vite reported only pre-existing chunk-size warnings.
- `npm test` — passed 895 tests.
- Focused final-readiness tests — passed 137 tests:
  - `node --test test/shared-app-artifact-search-gate.test.mjs test/chat-signals-api.test.mjs test/chat-web-shared-sessions.test.mjs test/cli-session-source.test.mjs test/debug-cli.test.mjs test/tools-cli.test.mjs test/data-v2-store.test.mjs test/data-shared-app-migration.test.mjs test/ralph-resource-visibility.test.mjs test/chat-cron-api.test.mjs`
- Focused Workflow V2/session-data retest — passed 40 tests:
  - `node --test test/ink-cli-v2-current-state.test.mjs test/pibo-data-session-store.test.mjs test/workflow-v2-builder-editing-raw-ir.test.mjs test/workflow-v2-builder-security-checklist.test.mjs test/workflow-v2-composition-boundaries.test.mjs test/workflow-v2-core-node-refs.test.mjs test/workflow-v2-deferrals.test.mjs test/workflow-v2-library-actions-ui.test.mjs test/workflow-v2-lifecycle-checklist.test.mjs test/workflow-v2-lifecycle-confirmation-ui.test.mjs test/workflow-v2-project-configured-ui.test.mjs test/workflow-v2-project-run-checklist.test.mjs test/workflow-v2-release-coverage.test.mjs test/workflow-v2-run-inspection-human-actions.test.mjs test/workflow-v2-security-boundary.test.mjs test/workflow-v2-state-mapping-ui.test.mjs`
- Real Ralph/Cron CLI smoke — passed:
  - Created and listed Ralph and Cron jobs through `node dist/bin/pibo.js ...` using temporary stores without `--owner-scope`; JSON assertions verified `ownerScope: "shared:app"` and shared default targets.

## Completed host Dev validation

User approval for host Dev operations was present for US-018 only. Production operations remain forbidden.

- `PIBO_DEV_PUBLIC_URL=http://127.0.0.1:4808/apps/chat PIBO_DEV_BRANCH=shared-app-no-owner-scope-ralph PIBO_DEV_WORKTREE=$PWD PIBO_DEV_REMOTE=localdev ./scripts/deploy-web-dev.sh` — passed.
  - The temporary `localdev` remote pointed at `/root/code/pibo` so the deploy script could validate the local Ralph branch through its normal clean-worktree/sync path; the temporary remote was removed afterward.
  - Build completed from commit `1c65386` on `shared-app-no-owner-scope-ralph`.
  - Existing Dev web app was reachable at the loopback Dev URL before restart.
- `pibo gateway dev restart` — passed.
- `pibo gateway dev status` — passed after restart with `reachable: yes`, `mode: dev`, `runtime sessions: 0`, `active yielded runs: 0`.
- Unauthenticated Dev API check confirmed auth still gates Chat APIs:
  - `curl http://127.0.0.1:4808/api/chat/bootstrap` returned `401 {"error":"Unauthenticated"}`.
  - The same request with `x-test-user` also returned `401`, confirming host Dev uses Better Auth rather than test-header auth.
- Browser auth-boundary check with Agent Browser reached the Dev Chat app and Google sign-in page. No authenticated Chat UI state was available.

## Completed Docker dev-auth Chat Web validation

Per user clarification, the remaining authenticated Chat Web validation was completed through the isolated Docker worker gateway with dev-auth instead of a Better Auth host Dev browser profile. The gateway was started inside the existing Docker dev worker with `runWebGatewayServer({ devAuth: true, web: { host: "0.0.0.0", port: 4788 } })` and `PIBO_HOME=/workspace/.pibo/ralph-sandbox`; host port `4822` mapped to the worker web port.

Evidence from 2026-05-30T10:54Z-11:01Z:

- Dev-auth login flow passed: `curl -L -c /tmp/pibo-dev-auth-cookie.txt http://127.0.0.1:4822/api/auth/sign-in/social`, then `/api/auth/session` returned `dev-user-001` / `dev@pibo.local`.
- API validation passed for historical `shared:app` session `ps_cd450c31-33b1-413b-b574-66ef55a5258f` in room `room_209cf2ff-6b46-4705-a216-a6d2138604bd`: bootstrap selected the session, navigation included it, and `/api/chat/message` stored a `user.message.accepted` event with actor `shared:app`. The runtime response reported missing provider credentials on first send, so the duplicate request with the same `clientTxnId` verified the accepted Chat event without starting another runtime turn.
- API validation passed for historical `user:*` session `ps_43d015b4-e9af-4502-8bb5-3ef266a0392e` in the same room: bootstrap selected the session, navigation included it, and `/api/chat/message` stored a `user.message.accepted` event with actor `shared:app` using the duplicate-request check after the expected provider-auth runtime failure.
- API validation passed for newly created shared-app session `ps_45133920-06d8-4a4a-b2b5-8b16e3e8e2e5`: `POST /api/chat/sessions` returned `ownerScope: "shared:app"`, bootstrap/navigation selected it, and `/api/chat/message` stored a `user.message.accepted` event with actor `shared:app` using the duplicate-request check after the expected provider-auth runtime failure.
- Browser validation passed with Agent Browser inside the Docker worker after dev-auth login: the Chat UI showed `dev@pibo.local`, sidebar/session entries, direct-open URLs under `/apps/chat/rooms/<roomId>/sessions/<piboSessionId>`, and composer availability for the historical shared session (`Recovery`), historical user session (`Umbauprobleme`), and newly created shared-app session (`Untitled Session`). The historical user session was also opened through the visible sidebar entry after one direct navigation timed out at the browser tool layer; `agent-browser get url` confirmed the canonical room/session URL.

The only runtime limitation observed during message sends was provider authentication for `openai-codex/gpt-5.5`, which is unrelated to shared-app visibility/routing. Chat accepted the messages and persisted app-global `user.message.accepted` events before the runtime provider-auth error.

## Production rollout and rollback notes

Authenticated validation for this report is complete. Do not deploy or mutate Production until separate Production approval is granted.

Recommended rollout gate:

1. Keep the Dev deployment available for manual review of historical `shared:app`, historical `user:*`, and newly created shared-app Chat paths.
2. Re-check real Ralph and Cron CLI/API shared-app paths without required owner-scope if the PR branch changes after this report.
3. Ask separately before Production deploy.
4. Before any Production data mutation, create a fresh backup containing copies of every affected SQLite store, run `pibo data shared-app inspect --json`, run `pibo data shared-app dry-run --json`, review conflicts, then ask for explicit mutation approval.
5. Run `pibo data shared-app apply --backup <backup-path>` only after approval; apply now verifies backup SQLite copies with `PRAGMA quick_check` and refuses unresolved unique-index conflicts.

Rollback:

- Code rollback: redeploy the previous stable web build if Dev/Production validation fails before migration mutation.
- Data rollback: restore SQLite files from the backup path printed/referenced by the migration command.
- If mutation was partially applied, stop services through the Pibo CLI as approved, restore all affected SQLite stores from the same backup set, then restart through the Pibo CLI.
