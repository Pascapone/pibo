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

## 2026-05-17 run: owner switch and room-first command flow batch

Selected story group:

- `prd_02_owner_scope_recovery_profile.json` / `US-003` — Add `/owner` or `/profile` switch flow.
- `prd_04_room_session_navigation.json` / `US-003` — Make `/session` and `/room` room-first.

Intended validation plan:

- Refactor Ink command handling just enough to reuse owner and room picker construction for startup, `/owner`, `/profile`, `/session`, and `/room`.
- Implement owner switching so it closes any open session, clears transcript state, reloads rooms for the selected owner, and keeps owner/status/header visible.
- Implement `/session` as room picker -> room-scoped session picker with create-new action; implement `/room` as room picker for changing active room and reloading room-scoped sessions.
- Add focused reducer/command/source tests for owner switch state reset, cross-owner send rejection, `/session` room-first behavior, `/room` behavior, and empty-room create-new action.
- Run `npm run build` plus focused tests inside `pibo-dev-ink-cli-v2-web-parity`.
- Run `pibo debug pty` scripts for `/owner` switching and `/session`/`/room` room selection with raw/clean artifacts.
- Run `npm run typecheck`; run broader tests if changes affect shared behavior beyond the focused Ink/source paths.

Validation and results for owner switch and room-first command flow batch:

- Implemented `/owner` and `/profile` commands that open the effective-owner picker during an active CLI session. The existing owner selection path now closes the open session, clears transcript/session state, and reloads rooms for the newly selected owner.
- Implemented `/session` as room-first: it opens an owner-scoped room picker, then a room-scoped session picker with `+ New session in this room` for empty rooms.
- Implemented `/room` as an active-room picker using the same room-scoped session reload path.
- Added fake-source owner mismatch protection so attempts to send or mutate a session owned by a different owner fail clearly, matching the local source's owner validation.
- Added deterministic debug PTY room fixtures with `PIBO_DEBUG_PTY_CLI_SESSIONS_ROOMS` for owner/room command validation.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-session-app.test.mjs test/cli-session-source.test.mjs test/ink-cli-v2-current-state.test.mjs'` — passed 30/30 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-owner-switch && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-owner-switch --timeout-ms 60000 --idle-timeout-ms 15000 --cols 110 --rows 30 --wait-for "Select effective owner" --expect "Web user alpha" --expect "Web user beta" --press Enter --wait-for "Select room for Web user alpha" --expect "Alpha Room" --press Down --press Enter --wait-for "New session in Alpha Room" --press Enter --wait-for "Created session" --type "/owner" --press Enter --wait-for "Select effective owner" --press Down --press Enter --wait-for "Select room for Web user beta" --expect "Beta Room" --expect "Pibo CLI Sessions | local/direct | Web user beta (user:beta)" --press CtrlC -- env PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:alpha,user:beta PIBO_DEBUG_PTY_CLI_SESSIONS_ROOMS="user:alpha|room_alpha|Alpha Room;user:beta|room_beta|Beta Room" node dist/bin/pibo.js tui:sessions'` — passed.
  - Owner-switch PTY classification: real PTY path with deterministic mocked local router/source, not live provider. Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-owner-switch/raw.ansi.log`. Clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-owner-switch/clean.txt`.
  - Observed owner-switch PTY result: clean output shows alpha and beta owner picker choices, Alpha Room, created session in Alpha Room, `/owner`, switch to Web user beta, beta header, and Beta Room.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-room-session-commands && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-room-session-commands --timeout-ms 60000 --idle-timeout-ms 15000 --cols 110 --rows 30 --wait-for "Select room for Web user alpha" --expect "Personal Chat" --expect "Project Room" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/session" --press Enter --wait-for "Select room for sessions for Web user alpha" --expect "Project Room" --press Down --press Enter --wait-for "New session in Project Room" --press Escape --type "/room" --press Enter --wait-for "Select active room for Web user alpha" --expect "Project Room" --press Up --press Enter --wait-for "Select session in Personal Chat" --press CtrlC -- env PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:alpha PIBO_DEBUG_PTY_CLI_SESSIONS_ROOMS="user:alpha|room_personal|Personal Chat;user:alpha|room_project|Project Room" node dist/bin/pibo.js tui:sessions --owner-scope user:alpha'` — passed.
  - Room/session command PTY classification: real PTY path with deterministic mocked local router/source, not live provider. Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-room-session-commands/raw.ansi.log`. Clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-room-session-commands/clean.txt`.
  - Observed room/session command PTY result: clean output shows `/session` opening a room picker, selecting Project Room, reaching its empty create-new action, then `/room` opening the active-room picker and switching back to Personal Chat with the created session listed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
- Path classification: real PTY-backed CLI/TUI smoke tests with deterministic mocked local router/source; focused source/Ink unit tests. No Web DOM behavior changed, so browser checks were not required for this batch.
- Completed stories marked `passes: true`: PRD 02 `US-003`; PRD 04 `US-003`.
- Implementation commit: `21dc2e6c35252141d37182d3aa59fa62678dfb7a`.
- Next recommended group: PRD 04 `US-004` and PRD 02 `US-005` for `/new` Web-visible creation through the selected owner/room, with store/API/Web navigation validation.

## 2026-05-17 run: /new Web-visible selected owner/room batch

Selected story group:

- `prd_04_room_session_navigation.json` / `US-004` — Make `/new` owner-scoped, room-scoped, and Web-visible.
- `prd_02_owner_scope_recovery_profile.json` / `US-005` — Verify selected Web owner sessions appear in Web UI.

Intended validation plan:

- Tighten `/new` handling so it creates in the explicit active room only when one is selected; otherwise it opens a room picker with Personal Chat/default preselected and creates in the selected room.
- Ensure local source session creation writes Web read-model session/navigation metadata for the selected owner/room immediately, and message send/output ingestion writes event-log/chat-message/observation rows under the same owner/room.
- Add focused unit/source tests for `/new` active-room creation, `/new` no-active-room picker behavior, and persisted sessions/session_navigation/event_log/chat_messages ownership/room metadata.
- Run focused tests after build in `pibo-dev-ink-cli-v2-web-parity`, then `npm run typecheck`.
- Run `pibo debug pty` with a temp `PIBO_HOME`, selected Web owner, deterministic local mock router, scripted `/new`/message input, and raw/clean PTY artifacts; then query the temp Pibo data store to confirm Web navigation/read-model visibility and record the `/rooms/<roomId>/sessions/<sessionId>` URL.

Validation and results for /new Web-visible selected owner/room batch:

- Implemented `/new` so it creates immediately only when an explicit `activeRoom` is selected in Ink state; otherwise it opens an owner-scoped room picker with Personal Chat/default preselected and creates in the selected room.
- Local CLI session creation now writes the Web read-model navigation row immediately for the selected owner/room. Sending a message through the local source writes `sessions`, `session_navigation`, `event_log`, `chat_messages`, and observations with selected owner/room metadata. Navigation preview updates now preserve user/assistant content instead of replacing it with `message_finished`.
- Added focused tests for `/new` active-room creation, `/new` no-active-room picker behavior, and persisted Web-visible `sessions`/`session_navigation`/`event_log`/`chat_messages` owner-room metadata.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-session-app.test.mjs test/cli-session-source.test.mjs test/ink-cli-v2-current-state.test.mjs'` — passed 32/32 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-new-web .tmp/pty-new-web-home && mkdir -p .tmp/pty-new-web-home && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-new-web --timeout-ms 60000 --idle-timeout-ms 15000 --cols 120 --rows 32 --wait-for "Select room for Web user pty" --expect "Personal Chat" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/new" --press Enter --wait-for "Created session" --type "Persist from PTY" --press Enter --wait-for "PTY assistant persisted" --expect "Message sent" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-new-web-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_ASSISTANT_REPLY="PTY assistant persisted" node dist/bin/pibo.js tui:sessions --owner-scope user:pty'` — passed.
  - PTY classification: real PTY path with `LocalCliSessionSource`, real `PiboDataStore` persistence, and deterministic mocked local router to avoid live provider credentials; not a fake source or demo path.
  - PTY artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-new-web/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-new-web/clean.txt`.
  - Observed PTY result: clean output shows `Web user pty (user:pty)`, Personal Chat selection, new-session creation, `/new`, sent message `Persist from PTY`, assistant reply `PTY assistant persisted`, and `Message sent.`
  - Store/API read-model check: queried `/workspace/.tmp/pty-new-web-home/pibo.sqlite` after the PTY run. Latest created session `ps_e55f4202-e8d9-4de4-9830-b17598c1d881` had `sessions.owner_scope=user:pty`, `sessions.room_id=room_6b3d9f0e-5d58-4cc0-bfaa-ff3ee2665107`, matching `session_navigation` owner/room/status `idle`, user and assistant `chat_messages` in the same room, and `event_log` rows for `user.message.accepted` and `assistant_message` in the same room.
  - Web URL for manual verification: `http://127.0.0.1:4822/apps/chat/rooms/room_6b3d9f0e-5d58-4cc0-bfaa-ff3ee2665107/sessions/ps_e55f4202-e8d9-4de4-9830-b17598c1d881`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 494 tests; 493 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Completed stories marked `passes: true`: PRD 04 `US-004`; PRD 02 `US-005`.
- Implementation commit: f4c2aa6 (`Make CLI new sessions Web-visible`).
- Next recommended group: PRD 04 `US-005` existing room session/transcript hydration, then PRD 02 `US-004` diagnostics/repair for legacy `user:unknown` sessions.

## 2026-05-17 run: legacy unknown repair and existing transcript hydration batch

Selected story group:

- `prd_02_owner_scope_recovery_profile.json` / `US-004` — Prevent and repair `user:unknown` CLI sessions.
- `prd_04_room_session_navigation.json` / `US-005` — Hydrate existing room sessions and transcript by owner.

Intended validation plan:

- Add a focused local-source repair API and Ink slash command for legacy `user:unknown` CLI sessions, scoped to the active owner and active/default room, updating `sessions` and `session_navigation` ownership/room metadata without selecting `user:unknown` by default.
- Treat existing owner-scoped sessions with missing room metadata as selected-owner Personal Chat in room-scoped CLI listings.
- Normalize persisted `user.message.accepted` event-log rows into CLI trace user-message nodes during existing-session hydration, preserving assistant events and owner/room filtering.
- Add focused source and Ink command tests for legacy repair, no implicit `user:unknown` new writes, room-scoped existing-session listing, cross-owner exclusion, and transcript hydration.
- Run `npm run build` plus focused tests inside `pibo-dev-ink-cli-v2-web-parity`.
- Run `pibo debug pty` scenarios for opening an existing session from the room picker and by `--session <id>`, with raw/clean artifacts and transcript assertions.
- Run `npm run typecheck`; run broader tests if the focused changes affect shared behavior beyond local CLI/session source paths.

Validation and results for legacy unknown repair and existing transcript hydration batch:

- Implemented `LocalCliSessionSource.repairLegacyUserUnknownSessions()` and an Ink `/repair-user-unknown` diagnostic/repair command. The repair path refuses `user:unknown` as a target, reassigns only CLI-origin legacy `user:unknown` sessions to the selected owner, maps them to the selected/default room, updates `sessions.owner_scope`/`sessions.room_id`, and upserts `session_navigation` owner/room/status.
- Existing owner-scoped sessions with missing room metadata now appear under the selected owner's Personal Chat/default room in CLI room-scoped listings and open-session summaries.
- Existing persisted `user.message.accepted` event-log rows are normalized into CLI user-message trace nodes during local-source hydration, so existing Web/Pibo-data transcripts show both user and assistant history in Ink.
- Focused validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-session-source.test.mjs test/cli-ui-session-app.test.mjs test/ink-cli-v2-current-state.test.mjs'` — passed after a test-only regex fix for Ink line wrapping.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && node --test test/cli-session-source.test.mjs test/cli-ui-session-app.test.mjs test/ink-cli-v2-current-state.test.mjs'` — passed 36/36 focused tests.
- PTY existing-session picker validation:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-existing-picker --timeout-ms 60000 --idle-timeout-ms 15000 --cols 120 --rows 32 --wait-for "Select room for Web user history" --expect "Personal Chat" --press Enter --wait-for "Select session in Personal Chat" --expect "Existing PTY Session" --press Enter --wait-for "Opened session Existing PTY Session" --expect "Existing PTY user prompt" --expect "Existing PTY assistant reply" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-existing-home node dist/bin/pibo.js tui:sessions --owner-scope user:history'` — passed.
  - Classification: real PTY path using `LocalCliSessionSource` and a real temp `PiboDataStore` fixture; no fake source/demo path and no live provider send.
  - Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-existing-picker/raw.ansi.log`.
  - Clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-existing-picker/clean.txt`.
  - Observed result: clean output shows Personal Chat selection, `Existing PTY Session`, `Opened session Existing PTY Session`, `Existing PTY user prompt`, and `Existing PTY assistant reply`.
- PTY direct `--session` hydration validation:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-existing-direct --timeout-ms 60000 --idle-timeout-ms 15000 --cols 120 --rows 32 --wait-for "Existing PTY user prompt" --expect "Existing PTY assistant reply" --expect "Pibo CLI Sessions | local/direct | Web user history (user:history) | Existing PTY Session" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-existing-home node dist/bin/pibo.js tui:sessions --owner-scope user:history --session ps_pty_history'` — passed.
  - Classification: real PTY path using `LocalCliSessionSource` and the same real temp `PiboDataStore` fixture; no fake source/demo path and no live provider send.
  - Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-existing-direct/raw.ansi.log`.
  - Clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-existing-direct/clean.txt`.
  - Observed result: clean output shows direct-open header for `Web user history (user:history) | Existing PTY Session` plus the persisted user and assistant transcript lines.
- `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
- `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 498 tests; 497 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Completed stories marked `passes: true`: PRD 02 `US-004`; PRD 04 `US-005`.
- Implementation commit: pending.
- Next recommended group: PRD 03 `US-001` through `US-004` shared terminal/card/status/command/picker descriptors, then PRD 05 catalog stories that consume those descriptors.
