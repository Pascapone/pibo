# Ink CLI Session UI V2 Web Parity Implementation Progress

## Ralph job setup

- Created: 2026-05-17
- Owner scope: `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa`
- Target room: `room_557eda90-943d-4fc0-b2d6-c13b44d080cc`
- Profile: `pibo-agent`
- Template: `prd-batch-stories`
- Total PRD stories: 33
- Max iterations: 99
- Worktree: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity`
- Branch: `ink-cli-v2-web-parity`
- Docker dev worker: `pibo-dev-ink-cli-v2-web-parity`
- Container workspace: `/workspace`
- Docker web port: `4822`
- Docker gateway port: `4820`
- Docker CDP port: `4821`
- Docker Chat UI port: `4823`
- Docker Context Files UI port: `4824`

## Scope

Implement PRDs under:

`docs/specs/changes/ink-cli-session-ui-v2-web-parity/prds/prd_*.json`

Related specs:

- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/proposal.md`
- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/spec.md`
- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/design.md`
- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/tasks.md`

## Operating notes

- Keep implementation work in the dedicated host worktree above.
- The Pibo room should be configured to start agents in `/root/code/pibo/.worktrees/ink-cli-v2-web-parity`.
- Reuse the dedicated Docker dev worker for runtime, tests, dev gateway, browser checks, and real PTY-backed checks.
- Container path is `/workspace`; host worktree is bind-mounted there.
- Run container commands as `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && <command>'`.
- Git metadata may be unreliable inside the container; run git operations and commits on the host worktree path.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host `pibo-web.service`.
- Do not expose credentials in prompts, logs, commits, PTY artifacts, or reports.
- Use `pibo debug pty ...` for real PTY-backed CLI/TUI smoke tests, scripted input, assertions, and raw/clean artifacts.
- Fake/demo/mocked checks are supporting evidence only; user-facing CLI/TUI stories need the closest practical real/default path when feasible.
- Batch user stories sensibly. A run may complete multiple coherent stories, but must stop rather than push through ambiguity, failed tests, or unsafe changes.
- Commit after each completed story or coherent story group.
- Before starting new work, review recent commits in this worktree/branch.
- When a story is marked `passes: true`, its `notes` must record concrete evidence: commands run, PTY scenario if relevant, raw/clean artifact paths, Web/browser checks if relevant, and commit hash.

## Codebase Patterns

- Shared Web/CLI terminal presentation should live in renderer-neutral `src/session-ui` modules.
- Ink renderer modules must not import Web DOM/CSS/browser presentation dependencies.
- Web DOM components must not be imported into CLI renderer modules.
- Host-root CLI owner impersonation is a deliberate local recovery/admin mode and must show the active owner before actions.
- New CLI sessions must never silently use `user:unknown`.

## Progress log

- 2026-05-17: Created worktree, committed V2 specs/PRDs, spawned dedicated dev worker, and prepared Ralph prompt parameters.

## 2026-05-17 run: PRD 01 current-state audit batch

Selected story group:

- `prd_01_product_scope_and_current_state.json` / `US-001` — Audit current Web and Ink terminal sharing.
- `prd_01_product_scope_and_current_state.json` / `US-002` — Document V2 parity scope and command inventory.
- `prd_01_product_scope_and_current_state.json` / `US-003` — Reproduce/document owner-scope visibility bug.

Intended validation plan:

- Add a canonical current-state report under `docs/reports/` covering shared `src/session-ui`, Web compact terminal DOM components, Ink components, CLI source/runtime integration, V2 command inventory, unsupported/product-area boundaries, PTY validation conventions, and the `user:unknown` Web visibility bug.
- Add a focused test fixture documenting the current owner fallback and a pending regression for the future no-`user:unknown` behavior.
- Run focused build/test for the new/changed tests inside `pibo-dev-ink-cli-v2-web-parity`.
- Run `npm run typecheck` inside `pibo-dev-ink-cli-v2-web-parity`.
- Update PRD JSON story notes with evidence and commit hash, then commit the coherent audit batch from the host worktree.

Validation and results for PRD 01 current-state audit batch:

- Added `docs/reports/ink-cli-session-ui-v2-current-state.md` with the current shared Web/Ink surface, DOM-only Web compact terminal map, Ink renderer map, CLI source/runtime integration map, V2 scope matrix, gateway/Web/CLI command inventory, unsupported/product-area boundaries, owner-scope bug analysis, and PTY validation convention.
- Added `test/ink-cli-v2-current-state.test.mjs`:
  - active report coverage test for shared surface, command inventory, owner-scope fields, and PTY convention;
  - active persistent-path reproduction showing no-owner CLI creation writes `sessions.owner_scope = user:unknown` and message ingest writes `session_navigation.owner_scope = user:unknown`, making the session absent from `find({ ownerScope: "user:real-web-owner" })`;
  - skipped pending regression fixture for the future V2 no-implicit-`user:unknown` behavior.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty --help'` — passed; confirmed PTY debug command surface for documentation.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build && node --test test/ink-cli-v2-current-state.test.mjs'` — build passed; first test run exposed the fixture used unavailable `pibo-agent` in this registry, then the fixture was corrected to `codex-compat-openai-web`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && node --test test/ink-cli-v2-current-state.test.mjs'` — passed: 2 passing, 1 skipped pending fixture.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
- Path classification: documentation/test audit plus real persistent local source reproduction. No user-facing TUI behavior changed, so no PTY raw/clean artifacts were required for this batch.
- Completed stories marked `passes: true`: PRD 01 `US-001`, `US-002`, `US-003`.
- Implementation commit: `d8095bc` (`Audit Ink CLI V2 current state`).
- Next recommended group: PRD 02 `US-001` owner discovery and Root recovery owner, then PRD 04 `US-001` source owner/room contract expansion if needed as a dependency.

## 2026-05-17 run: PRD 02 owner discovery and source contract batch

Selected story group:

- `prd_02_owner_scope_recovery_profile.json` / `US-001` — Add owner discovery and Root recovery owner.
- `prd_04_room_session_navigation.json` / `US-001` — Expand CLI source owner and room contracts, limited to the source/API foundation needed by owner discovery and default-room mapping.

Intended validation plan:

- Add renderer-neutral CLI session source owner types/methods for active owner, discovered owners, owner-scoped room/session listing, and room-scoped creation.
- Implement local owner discovery from session store, session navigation, rooms, event log, custom agents when available, plus explicit configured owner scope.
- Define a stable Root recovery owner scope and ensure a selected/fallback owner has a Personal Chat/default room available through local data room service when available, or a deterministic virtual room for memory-only tests.
- Preserve `--session`/existing source compatibility by defaulting local sources with no explicit owner to the resolved single/fallback owner rather than `user:unknown`.
- Add focused source tests for no owners, one owner, multiple owners, owner/room/session filtering, and create-session owner/default-room behavior.
- Run `npm run build`, focused source tests, and `npm run typecheck` inside `pibo-dev-ink-cli-v2-web-parity` before committing.

Validation and results for PRD 02 owner discovery/source contract batch:

- Implemented `CliOwnerSummary`, active-owner source methods, owner-aware `listRooms`/`listSessions`, active owner status fields, selected-owner default-room creation, and deterministic Root recovery fallback `local:root`.
- Local owner discovery now considers explicit `--owner-scope`, existing sessions, Pibo data `rooms`, `session_navigation`, `sessions`, event-log actor owner scopes, and custom-agent owner hints from the default CLI source context. Legacy implicit `user:unknown` is not selected unless explicitly requested.
- Selected/fallback owners get a Personal Chat/default room through `ChatRoomService` when a `PiboDataStore` is available, or a deterministic virtual room otherwise.
- Updated CLI status/header and `/status` formatting to show the active owner label/scope.
- Updated the current-state regression fixture so the V2 default local source now verifies `local:root` instead of reproducing new `user:unknown` writes.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-session-source.test.mjs test/ink-cli-v2-current-state.test.mjs test/cli-ui-session-app.test.mjs'` — passed 25/25 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — failed in unrelated `test/telemetry-store.test.mjs` / `telemetry stale, stats, and prune are read-oriented by default`; standalone rerun of that telemetry test also failed. This batch's focused tests passed.
- Path classification: real local source/unit integration path against in-memory and temp SQLite Pibo data stores. No user-facing interactive TUI flow changed in this batch beyond owner/status text, so no PTY raw/clean artifacts were required by these two source-contract stories.
- Completed stories marked `passes: true`: PRD 02 `US-001`; PRD 04 `US-001`.
- Implementation commit: `13c0b33` (`Add CLI owner discovery source contracts`).
- Blocker/next step: investigate the unrelated telemetry prune test before relying on full `npm test`; next PRD group should implement PRD 02 `US-002` owner picker and active owner startup state, with PTY validation.

## 2026-05-17 run: owner/startup picker flow batch

Selected story group:

- `prd_02_owner_scope_recovery_profile.json` / `US-002` — Implement owner picker and active owner startup state.
- `prd_04_room_session_navigation.json` / `US-002` — Implement startup owner room session flow.

Intended validation plan:

- Add a mutable active-owner source method so the Ink startup owner picker can select an effective owner before loading rooms/sessions while preserving explicit `--owner-scope` startup behavior.
- Extend the Ink picker state from flat session/agent choices to owner, room, and room-scoped session choices, including a create-new-session item for empty or selected rooms.
- On no `--session`, start with owner selection when multiple owners exist, then room selection, then room-scoped session selection/create-new; keep direct `--session` open behavior.
- Add focused source and Ink reducer/view/command tests for owner switching primitives, owner picker rendering, startup picker decisions, room-to-session picker transitions, and create-new in selected room.
- Run `npm run build` plus focused tests inside `pibo-dev-ink-cli-v2-web-parity`, run `pibo debug pty` scenarios for owner picker and owner-room-session sequence with raw/clean artifacts, then run `npm run typecheck` before committing.

Validation and results for owner/startup picker flow batch:

- Implemented `CliSessionSource.setActiveOwner(ownerScope)` with local and fake source support. Local owner switching updates the active owner, owner scope, and selected-owner Personal Chat/default room; fake source switching filters owner-scoped rooms and sessions for tests.
- Added Ink startup owner selection when multiple owners are discovered, while preserving direct `--session` open and explicit `--owner-scope` skip behavior.
- Added room-first startup navigation: selected owner -> room picker -> room-scoped session picker with `+ New session in this room`; selecting create opens a session in the selected owner/room.
- Added a deterministic debug PTY owner fixture via `PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS` for real PTY startup picker checks without live provider credentials.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-session-source.test.mjs test/cli-ui-session-app.test.mjs test/ink-cli-v2-current-state.test.mjs'` — passed 28/28 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-owner-room --timeout-ms 45000 --idle-timeout-ms 12000 --cols 100 --rows 28 --wait-for "Select effective owner" --expect "Web user alpha" --expect "Web user beta" --press Down --press Enter --wait-for "Select room for Web user beta" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --press CtrlC -- env PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:alpha,user:beta node dist/bin/pibo.js tui:sessions'` — passed.
  - PTY artifact classification: real PTY path with deterministic mocked local router/source, not live provider. Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-owner-room/raw.ansi.log`; clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-owner-room/clean.txt`.
  - Observed PTY result: clean output shows `Select effective owner`, `Web user alpha`, `Web user beta`, selected `Web user beta (user:beta)` in the header, `Select room for Web user beta`, `+ New session in Personal Chat`, and `Created session New CLI session.`
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — failed only in the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion; 489/490 tests passed.
- Completed stories marked `passes: true`: PRD 02 `US-002`; PRD 04 `US-002`.
- Implementation commit: `19aea5d` (`Add Ink owner and startup room pickers`).
- Next recommended group: PRD 02 `US-003` and PRD 04 `US-003` for `/owner`, `/room`, and room-first `/session` switching, building on the new picker/source primitives.
