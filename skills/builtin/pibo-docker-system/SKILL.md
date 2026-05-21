---
name: pibo-docker-system
description: Use this skill for Pibo Docker Compute System work, isolated implementation, worker worktrees, Chat Web or gateway testing, worker dev auth, browser/CDP validation, resource cleanup, and when coordinating Docker worker use with the github-server-flow strategy.
---

# Pibo Docker Compute System

Use Docker compute workers as the isolated execution boundary for Pibo code work, gateway checks, Chat Web validation, browser automation, and end-to-end tests. Keep Docker-specific operating rules here instead of duplicating them in `AGENTS.md`.

## Relationship to GitHub flow

Use this skill together with `github-server-flow`:

- `github-server-flow` owns branch, PR, fork mirror, and release strategy.
- `pibo-docker-system` owns where implementation and validation run.
- Normal code work starts from `upstream/dev` on a focused branch, then runs inside a Docker dev worker.
- Do not use `origin/dev` as a preview or staging branch just to test work. Push focused branches to `origin` and open PRs to `upstream/dev`.
- Documentation-only edits do not require a Docker worker unless they are coupled to code, build, gateway, or browser validation.

### Worker branch pattern

`pibo compute dev spawn --worktree <name>` creates or attaches a Git worktree and uses `<name>` as the local branch name. Because container names and worktree names should be simple, prefer a slash-free local worker branch and push it to a slash-based PR branch when ready.

Recommended pattern:

```bash
cd /root/code/pibo
git fetch origin --prune
git fetch upstream --prune

# Use a slash-free local branch/worktree name created from upstream/dev.
git branch <short-topic> upstream/dev
pibo compute dev spawn --worktree <short-topic>

# Work in the returned worktree, then push as a focused PR branch.
cd /root/code/pibo/.worktrees/<short-topic>
git push -u origin HEAD:feature/<short-topic>
```

If the local branch already exists and points at the intended base, `pibo compute dev spawn --worktree <short-topic>` attaches a worktree for it. If it does not exist, the compute CLI creates it from the current checkout, so pre-create the branch from `upstream/dev` when strict upstream-first history matters.

## Commands

Discover progressively with the CLI first:

```bash
pibo compute --help
pibo compute dev --help
pibo compute dev spawn --help
```

Common commands:

- `pibo compute spawn [--name <name>]` — create a short-lived worker container. It is useful for isolated checks but does not create the development worktree flow.
- `pibo compute dev spawn --worktree <name>` — create a long-lived dev worker with a Git worktree and deterministic port block.
- `pibo compute rebuild` — force a fresh Docker image build.
- `pibo compute list` / `pibo compute list --all` — inspect worker and dev-worker containers.
- `pibo compute release <id>` — stop and remove the named worker container. This does not delete the Git worktree.
- `pibo compute reap --dry-run` — preview worker cleanup.
- `pibo compute reap --apply` — apply selected cleanup. Dev workers are excluded unless the command explicitly includes them.
- `pibo compute health` / `pibo compute doctor` — read-only resource health checks.
- `pibo compute diagnostics` / `pibo compute disk` — read-only Docker disk diagnostics.

## Development rule

Use a Docker dev worker for Pibo code and feature implementation whenever the compute system is available, especially for:

- gateway changes;
- Chat Web changes;
- browser automation;
- auth behavior;
- runtime/session routing changes;
- CLI/TUI changes that need realistic user-visible validation;
- end-to-end checks.

Do not edit the host checkout as an experimental workspace for code changes. Do not restart, replace, or run ad hoc host gateways for development unless the user explicitly requests host operations or Docker is unavailable. The host gateway is for observation and production/dev deployment only.

## Worker lifecycle

1. Start from the GitHub strategy: fetch remotes, create a focused branch from `upstream/dev`, and spawn a dev worker for that branch.
2. Use the returned worktree for edits.
3. Use the returned web and CDP ports for app and browser checks.
4. Run builds/tests inside the worker worktree when the work requires runtime validation.
5. Release the container with `pibo compute release <id>` when done.
6. Keep, merge, push, or discard the Git worktree only after review or explicit user approval.

Releasing a dev worker removes the container, not the worktree. Worktree deletion is a separate Git cleanup decision.

## Gateway and deployment boundaries

Host gateways are managed only through the Pibo CLI:

```bash
pibo gateway web status
pibo gateway web start
pibo gateway web restart
pibo gateway dev status
pibo gateway dev start
pibo gateway dev restart
```

After Docker validation, use the host dev gateway for host-level testing:

```bash
./scripts/deploy-web-dev.sh
pibo gateway dev restart
```

The hosted dev Chat URL is host-specific. Set `PIBO_DEV_PUBLIC_URL` or `PIBO_DEV_BASE_URL` in the environment or repo-local `.env.developer-host`; do not hard-code public hostnames in docs, scripts, or skills.

Deploy production only after dev testing succeeds and the user approves it:

```bash
./scripts/deploy-web.sh
pibo gateway web restart
```

If the production gateway restart is blocked because active agent work is running, ask the user before interrupting sessions. Do not bypass the CLI restart guard without explicit confirmation.

## Dev auth boundary

Dev auth belongs only to Docker workers.

- `gateway:web` inside a worker enables dev auth through the Docker entrypoint's internal option.
- `PIBO_DEV_AUTH` does not enable dev auth for normal host gateways.
- Never start the host gateway with dev-auth flags or fake-auth infrastructure.
- The normal host gateway must use Better Auth.
- Dev-auth web access is loopback-only; if a worker web port is accidentally reached through a public reverse proxy, auth requests are rejected.

If auth is needed inside a Docker worker, use the `pibo-debug-auth` skill rather than bypassing auth ad hoc.

## Browser and app validation

For Chat Web browser debugging while changing Pibo, start from the Docker dev worker when one is available. Use the worker's returned web/CDP ports so browser automation and gateway restarts stay isolated from host gateways.

Useful validation evidence includes:

- route visited;
- visible state or DOM assertions;
- screenshot path;
- CDP target details;
- request/response evidence;
- terminal output for CLI/TUI flows.

A gateway healthcheck only proves the service responds. For Web, CLI, TUI, gateway, runtime, auth, or agent-routing work, also verify user-visible behavior when feasible:

- Use browser/CDP or browser-use for Web UI flows.
- Use a pseudo-TTY or interactive shell for Ink/TUI flows.
- Use the real command, API, router, or persistence path when the default path is locally testable.

Fake/demo checks and healthchecks are useful supporting evidence, but do not treat them as final validation for a user-facing default path unless the real path is unavailable or explicitly out of scope.

## Resource hygiene

- Workers are intended to be bounded and recyclable.
- Prefer `pibo compute release <id>` when you finish with a worker.
- Use `pibo compute list --all` to inspect running, stopped, dirty, and OOM-killed workers.
- Use `pibo compute reap --dry-run` before destructive cleanup.
- Use `pibo compute health` and `pibo compute diagnostics --json` for read-only resource investigations.
- Do not delete worktrees just because containers were released. Worktree cleanup must be explicit.

## Source docs

For exact product requirements and implementation details, read the canonical docs on demand:

- `docs/specs/capabilities/docker-compute-workers.md`
- `docs/specs/capabilities/standalone-docker-runtime.md`
- `docs/project/compute-browser-resource-operating-model.md`
- `docs/project/compute-browser-resource-rollout-checklist.md`
- `src/skills/pibo-debug-auth/SKILL.md`
