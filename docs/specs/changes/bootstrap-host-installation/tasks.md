# Tasks: Bootstrap Host Installation

**Status:** Draft
**Created:** 2026-05-18

## Phase 1 — Planner and documentation

- [x] Add `pibo setup` CLI area.
- [x] Add `user-host` setup plan.
- [x] Add `developer-host` setup plan.
- [x] Render systemd, Caddy, and environment templates.
- [x] Document user-host install.
- [x] Document developer-host install.
- [x] Document user-host to developer-host upgrade.
- [x] Add tests for JSON plans and discovery.
- [x] Run typecheck/build.

## Phase 2 — Safer host application

- [ ] Add `--write-to <dir>` for rendering files into a review directory.
- [ ] Add host prerequisite checks for Docker, Caddy, systemd, and Git remotes.
- [ ] Add optional `--apply --yes` with atomic writes and rollback notes.
- [ ] Add health checks for production and dev gateways.

## Phase 3 — CI and packaging

- [ ] Add CI smoke tests for `pibo setup user-host --json`.
- [ ] Add CI smoke tests for `pibo setup developer-host --json`.
- [ ] Ensure setup docs are linked from README.
- [ ] Revisit `package.json#files` for v2 packaging docs.

## Phase 4 — Developer workflow polish

- [ ] Make dev branch deploy use the dev worktree automatically.
- [ ] Decide whether dev `PIBO_HOME` copies user skills by default.
- [ ] Validate GitHub App secret locations in a non-secret doctor check.
- [ ] Add Docker compute worker doctor checks.
