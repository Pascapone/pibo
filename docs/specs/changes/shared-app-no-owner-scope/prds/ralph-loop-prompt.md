# Ralph Auftrag: Shared App Without Owner Scope

Implement the shared-app/no-owner-scope migration iteratively from the prepared PRD story batch.

## Environment

- Host worktree: `/root/code/pibo/.worktrees/shared-app-no-owner-scope-ralph`
- Branch: `shared-app-no-owner-scope-ralph`
- Upstream base: `upstream/dev`
- Docker dev worker: `pibo-dev-shared-app-no-owner-scope-ralph`
- Container workspace: `/workspace`
- Worker gateway port: `4820`
- Worker CDP port: `4821`
- Worker web port: `4822`
- Worker Chat UI port: `4823`
- Worker Context UI port: `4824`
- Chat room: `room_4a58fe2a-7972-4e67-af79-3383ff1a4906`
- Room workspace: `/root/code/pibo/.worktrees/shared-app-no-owner-scope-ralph`
- Verified host DB backup: `/root/.pibo/backups/shared-app-no-owner-scope-vacuum-20260530T003254Z`
- Sandbox Pibo home in Docker: `/workspace/.pibo/ralph-sandbox`
- Sandbox Pibo home on host: `/root/code/pibo/.worktrees/shared-app-no-owner-scope-ralph/.pibo/ralph-sandbox`
- Worker helper: `.pibo/ralph-worker.sh '<command>'`

## Source documents

Read these at the beginning of each Ralph session before editing:

1. `IMPLEMENTATION_PROGRESS.md`
2. `IMPLEMENTATION_INSIGHTS.md`
3. `docs/specs/changes/shared-app-no-owner-scope/prds/shared-app-no-owner-scope.prd.json`
4. `docs/specs/changes/shared-app-no-owner-scope/prds/shared-app-no-owner-scope-prd.md`
5. `docs/specs/changes/shared-app-no-owner-scope/spec.md`
6. `docs/specs/changes/shared-app-no-owner-scope/design.md`
7. `docs/specs/changes/shared-app-no-owner-scope/tasks.md`

Also read nearby implementation files as needed for the selected story.

## Product contract

Pibo must become one shared app space:

- Auth is only an access gate.
- There is no user space after login.
- All allowed accounts see the same sessions, rooms, working directories, Custom Agents, Projects, Workflows, Web Annotations, Ralph jobs, Cron jobs, settings, diagnostics, and persisted history.
- Account-derived `ownerScope`, `owner_scope`, `principalId`, and `principal_id` must not control product visibility, routing, workspace selection, profile registration, job control, or write location.
- `shared:app` may exist only as explicitly marked legacy storage/migration compatibility until schema cleanup removes or neutralizes it.
- Do not introduce teams, roles, admins, resource permissions, or another account-based partition.

## Mandatory startup steps for every session

1. `cd /root/code/pibo/.worktrees/shared-app-no-owner-scope-ralph`.
2. Run `git status --short --branch` on the host worktree.
3. Inspect recent commits with `git log --oneline --decorate -n 8`.
4. Read `IMPLEMENTATION_PROGRESS.md` completely.
5. Read `IMPLEMENTATION_INSIGHTS.md` completely.
6. Read the PRD JSON and source docs listed above.
7. Pick the highest-priority story with `passes: false`, unless progress/insights document a safer dependency order.
8. Write the selected story, plan, and intended validation to `IMPLEMENTATION_PROGRESS.md` before editing.

## Docker isolation rules

Use the Docker worker for shell commands, builds, tests, gateway checks, browser checks, migration dry-runs, and runtime validation. Prefer the helper from the host worktree:

```bash
.pibo/ralph-worker.sh '<command>'
```

The helper runs inside `/workspace` and exports `PIBO_HOME=/workspace/.pibo/ralph-sandbox`, which is a verified copy of the host SQLite stores plus payloads. If you must call `docker exec` directly, include `export PIBO_HOME=/workspace/.pibo/ralph-sandbox` before any Pibo command, migration command, dry-run, or test that touches Pibo home.

Keep source edits and git commits in the host worktree path. Do not run builds/tests in the host checkout. Do not restart or modify host production gateways or production services. Host Dev deploy/restart/API/browser validation is approved only for US-018. Do not run migration tests, exploratory Pibo CLI commands, or dry-runs against `/root/.pibo`; use the sandbox `PIBO_HOME`. Do not create, release, or replace Docker workers unless the user explicitly approves.

Git metadata may not work inside the container because `/workspace/.git` points to host worktree metadata. Run git status, git diff, git add, git commit, and git log on the host worktree.

## Story execution rules

- Work in priority order from `shared-app-no-owner-scope.prd.json`.
- Prefer one story per Ralph run. Combine stories only when they are tightly coupled and small enough to validate together.
- Keep changes surgical and focused.
- Do not mark a story complete unless all its acceptance criteria pass.
- When a story is complete, update its JSON entry:
  - set `passes` to `true`,
  - add a concise `notes` entry with commands run, evidence tier, real-path/browser/CLI checks, commit hash if already known, and remaining caveats.
- Commit after each completed story or coherent story group from the host worktree.
- Use commit message format: `feat: US-XXX - short story title`.
- If blocked, document the blocker in both the PRD JSON notes and `IMPLEMENTATION_PROGRESS.md`, then stop the session without marking the story complete.

## Required progress and insights updates

Update `IMPLEMENTATION_PROGRESS.md` after every meaningful step:

- selected story,
- implementation plan,
- files changed,
- commands run,
- test/build/browser/CLI evidence,
- commit hash,
- blockers,
- next recommended action.

Update `IMPLEMENTATION_INSIGHTS.md` whenever you discover reusable information that later sessions need:

- owner/principal code patterns,
- schema gotchas,
- migration conflict rules,
- test fixture patterns,
- CLI/API behavior,
- Docker/browser validation lessons,
- anything that prevents repeated rediscovery.

## Validation rules

Minimum validation before story completion:

- Run `npm run typecheck` in Docker unless the story documents a valid exception.
- Run focused tests for touched areas in Docker.
- For Chat Web, CLI, runtime, auth, persistence, migration, gateway, or browser-facing behavior, exercise the closest practical real/default path in Docker or explain why it is deferred.
- Before PR readiness, the branch must pass `npm run typecheck`, `npm run build`, `npm test`, focused tests, and the owner/principal artifact search gate.

Use focused tests from the PRD where applicable, including Chat API/UI, session/router/store, agent/project/workflow, Ralph/Cron, web annotations, migration, and CLI/TUI tests.

For Docker authenticated Chat Web checks, use the worker dev-auth flow. Example pattern:

```bash
# Inside/against the Docker worker web port; use the actual worker URL/port from the progress file.
curl -L -c /tmp/pibo-dev-cookie.txt http://127.0.0.1:4822/api/auth/sign-in/social
curl -b /tmp/pibo-dev-cookie.txt http://127.0.0.1:4822/api/auth/session
```

Then call Chat Web APIs or use Agent Browser against the Docker worker URL with the authenticated dev-auth cookie/session.

## User clarification: Docker gateway validation

The user clarified that this Ralph loop should use its isolated Docker worker/gateway/dev-auth flow for authenticated Chat Web validation. Host Dev is primarily for user manual testing. For US-018:

- Prefer the Docker worker gateway and dev-auth flow for authenticated Chat Web API/browser validation.
- Use the worker web port and dev-auth login flow, not host Better Auth, when validating the historical `shared:app`, historical `user:*`, and newly created shared-app session paths.
- Host Dev deploy/restart/status evidence may stay in the report as rollout evidence, but lack of an authenticated Better Auth host Dev browser profile is no longer a blocker.
- Production remains forbidden unless separately approved.

## User approval update for US-018

The user explicitly approved host Dev validation operations for this loop. For US-018, you MAY run these host operations when needed:

- `./scripts/deploy-web-dev.sh`
- `pibo gateway dev restart`
- `pibo gateway dev status`
- host Dev API checks
- host Dev browser checks

This approval applies only to Dev. Production remains forbidden: do not run `./scripts/deploy-web.sh`, do not restart `pibo gateway web`, and do not mutate Production data unless a later user message explicitly approves that separate Production action.

## Forbidden actions

- Do not mutate production data.
- Do not use `/root/.pibo` as `PIBO_HOME` for implementation validation; use `/workspace/.pibo/ralph-sandbox`.
- Do not deploy to production.
- Do not restart host production gateways. Host Dev restart is approved for US-018 only.
- Do not force-stop active host sessions.
- Do not expose secrets, auth tokens, provider credentials, or private keys.
- Do not close unrelated security findings.
- Do not introduce a replacement user/tenant/role permission model.

## Completion rules

The job may stop only when all stories in `shared-app-no-owner-scope.prd.json` have `passes: true`, all global Definition of Done criteria in the PRD are satisfied, final validation evidence is recorded, and the branch is committed cleanly.

When and only when that is true, end the final answer with the promise-complete XML marker on its own line. Compose it from the opening tag `<promise>`, the word `COMPLETE`, and the closing tag `</promise>`.

Never quote, negate, explain, or mention the literal complete marker unless all completion criteria are satisfied and you intend to stop the job. If work remains, say `completion marker omitted`.
