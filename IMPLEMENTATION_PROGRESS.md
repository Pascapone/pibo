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
- Implementation commit: `1b442ef` (`Repair legacy CLI owners and hydrate sessions`).
- Next recommended group: PRD 03 `US-001` through `US-004` shared terminal/card/status/command/picker descriptors, then PRD 05 catalog stories that consume those descriptors.

## 2026-05-17 run: shared terminal descriptor foundation batch

Selected story group:

- `prd_03_shared_terminal_view_model_v2.json` / `US-001` — Add shared terminal card descriptors.
- `prd_03_shared_terminal_view_model_v2.json` / `US-002` — Add shared status and progress view model.
- `prd_03_shared_terminal_view_model_v2.json` / `US-003` — Add shared command catalog and result descriptors.
- `prd_03_shared_terminal_view_model_v2.json` / `US-004` — Add shared owner room session picker descriptors.

Intended validation plan:

- Add renderer-neutral modules under `src/session-ui` for terminal card descriptors, status/progress descriptors, command catalog/result descriptors, and owner/room/session picker descriptors.
- Keep these modules free of React, Ink, DOM, browser, CSS, and Web-only imports; export them through `src/session-ui/index.ts`.
- Add focused shared-model tests covering status, thinking, model, login, tool, yielded-run, compaction, error, progress unavailable-vs-zero semantics, redaction, command filtering/result normalization, and owner/room/session picker defaults/empty-room create actions.
- Run `npm run build` plus the focused session-ui tests in `pibo-dev-ink-cli-v2-web-parity`, then run `npm run typecheck` before committing.
- No user-facing Ink rendering is expected in this foundation slice, so PTY artifacts are not planned unless implementation changes the TUI render path.

Validation and results for shared terminal descriptor foundation batch:

- Added renderer-neutral shared modules under `src/session-ui`:
  - `terminalCards.ts` for status, thinking, model, login, tool, yielded-run, compaction, command, and error card descriptors.
  - `statusViewModel.ts` for status fields, context/provider progress descriptors, unavailable-vs-zero usage semantics, progress bar text, and shared redaction.
  - `commandCatalog.ts` and `commandResults.ts` for slash command descriptors, Web parity/CLI-only command catalog entries, unsupported reasons, filtering, and normalized action result descriptors.
  - `ownerViewModel.ts` and `roomSessionViewModel.ts` for owner, room, and session picker descriptors with markers, active/current/default/fallback/archived/disabled state, back items, and create-new actions.
- Exported the new shared modules through `src/session-ui/index.ts`; no `src/apps/cli-ui` file imports Web DOM/CSS/browser dependencies.
- Added `test/session-ui-view-models.test.mjs` covering rich card descriptors, status/progress unavailable and zero usage semantics, secret redaction, command catalog generation/filtering, command result normalization, owner picker descriptors, Personal Chat default room descriptors, empty-room create actions, and renderer-neutral source checks for all `src/session-ui/*.ts` files.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/session-ui-terminal-rows.test.mjs test/session-ui-view-models.test.mjs'` — passed 9/9 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 504 tests; 503 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Path classification: shared renderer-neutral model/unit path only. This batch did not change user-facing Ink rendering or command execution, so PTY artifacts were not required.
- Completed stories marked `passes: true`: PRD 03 `US-001`, `US-002`, `US-003`, `US-004`.
- Implementation commit: a423768fbd55d80f3a8c18ffed8828efa17030a4.
- Next recommended group: PRD 05 `US-001` and `US-005` to consume the shared command catalog in CLI help/suggestions groundwork, or PRD 03 `US-005` to wire a Web Compact Terminal rich-card path to the shared descriptors.

## 2026-05-17 run: shared slash catalog help and Ink suggestions batch

Selected story group:

- `prd_05_slash_command_catalog_and_actions.json` / `US-001` — Build shared slash command catalog for CLI and Web.
- `prd_05_slash_command_catalog_and_actions.json` / `US-002` — Implement slash suggestions in Ink input.
- `prd_05_slash_command_catalog_and_actions.json` / `US-005` — Replace hard-coded help with catalog help.

Intended validation plan:

- Extend the shared `src/session-ui` command catalog so it can merge gateway action infos with Web-added commands and CLI navigation commands while preserving terminal-specific ownership for `/session`, `/room`, `/owner`, `/profile`, `/new`, `/agent`, and exit/help commands.
- Expose `CliSessionSource.listSlashCommands()` from fake and local sources, backed by the default plugin registry gateway action infos for the local source.
- Replace hard-coded command header and `/help` text in the Ink app and CLI help with catalog-generated grouped output, including unsupported/deferred/browser-only reasons and owner/room/session keyboard controls.
- Add Ink slash suggestions for `/`, prefix filtering such as `/th`, arrow-key selection, Enter accept/run behavior, and Escape dismissal without changing the typed input.
- Add focused unit/render tests for catalog generation from gateway infos, grouped help output, suggestion reducer/view behavior, and source-provided command catalogs.
- Run `npm run build` plus focused tests inside `pibo-dev-ink-cli-v2-web-parity`; run `pibo debug pty` for `/help` and suggestions with raw/clean artifacts; run `npm run typecheck` before committing.

Validation and results for shared slash catalog help and Ink suggestions batch:

- Extended shared `src/session-ui/commandCatalog.ts` so the catalog merges default Web parity commands, CLI navigation/recovery commands, Web-added browser commands, and gateway action infos with `slashCommands` arrays. CLI-owned `/session`, `/room`, `/owner`, `/profile`, `/new`, `/agent`, `/help`, `/exit`, `/quit`, and `/repair-user-unknown` keep terminal semantics when a gateway action uses the same slash.
- Added grouped catalog helpers, support labels, first-token prefix filtering, and explicit unsupported/deferred/browser-only reasons.
- Exposed `CliSessionSource.listSlashCommands()` from fake and local sources. The local source derives commands from `pluginRegistry.getGatewayActionInfos()`.
- Replaced the hard-coded in-app command header, `pibo tui:sessions --help` command summary, and `/help` body with catalog-generated output grouped as Available Web/session actions, CLI navigation and recovery commands, and Unsupported or deferred terminal commands.
- Added Ink slash suggestions for `/` and prefixes such as `/th`; arrow keys move selection, Enter accepts a prefix or runs an exact selected command, and Escape closes suggestions without changing the typed input.
- Fixed multi-line `/help` rendering so each line is bounded separately instead of truncating the whole catalog into one line.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-session-app.test.mjs test/session-ui-view-models.test.mjs test/cli-session-source.test.mjs'` — passed 41/41 focused tests after the multi-line help render fix.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-slash-suggestions && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-slash-suggestions --timeout-ms 60000 --idle-timeout-ms 15000 --cols 120 --rows 34 --wait-for "Select room for Web user alpha" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/th" --wait-for "Slash commands" --expect "/thinking" --expect "/thinking-show" --press Down --expect "thinking-show" --press Escape --wait-for "Closed slash suggestions" --expect "› /th" --press CtrlC -- env PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:alpha node dist/bin/pibo.js tui:sessions --owner-scope user:alpha'` — passed.
  - Slash suggestions PTY classification: real PTY-backed CLI/TUI path with `LocalCliSessionSource` and deterministic mocked local router/source, not live provider. Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-slash-suggestions/raw.ansi.log`. Clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-slash-suggestions/clean.txt`.
  - Observed slash suggestions PTY result: clean output shows `Slash commands`, `/thinking`, `/thinking-show`, selected `thinking-show` after Down, `Closed slash suggestions`, and preserved input `› /th`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-slash-help .tmp/pty-slash-help-home && mkdir -p .tmp/pty-slash-help-home && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-slash-help --timeout-ms 60000 --idle-timeout-ms 15000 --cols 140 --rows 50 --wait-for "Select room for Web user alpha" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/help" --press Enter --wait-for "Slash command catalog" --expect "Available Web/session actions" --expect "CLI navigation and recovery commands" --expect "Unsupported or deferred terminal commands" --expect "/download" --expect "Keyboard controls" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-slash-help-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:alpha node dist/bin/pibo.js tui:sessions --owner-scope user:alpha'` — passed.
  - `/help` PTY classification: real PTY-backed CLI/TUI path with `LocalCliSessionSource`, temp `PIBO_HOME`, and deterministic mocked local router/source, not live provider. Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-slash-help/raw.ansi.log`. Clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-slash-help/clean.txt`.
  - Observed `/help` PTY result: clean output shows `Slash command catalog`, all three help groups, `/download`, and `Keyboard controls`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 505 tests; 504 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Path classification: shared model/source/unit path plus real PTY-backed CLI/TUI checks with deterministic mocked local router/source. No Web DOM behavior changed, so browser checks were not required for this batch.
- Completed stories marked `passes: true`: PRD 05 `US-001`, `US-002`, `US-005`.
- Implementation commit: `ddbecd4` (`Add Ink slash catalog help and suggestions`).
- Next recommended group: PRD 05 `US-003` and `US-004` for routed action execution (`/status`, `/compact`, `/clear`, `/abort`, `/kill`, `/kill-all`, `/fast`, `/session-current`, `/sessions`, `/clone`) using shared command result descriptors and PTY validation.

## 2026-05-17 run: routed slash action execution batch

Selected story group:

- `prd_05_slash_command_catalog_and_actions.json` / `US-003` — Execute basic routed slash actions.
- `prd_05_slash_command_catalog_and_actions.json` / `US-004` — Execute session metadata and clone actions.

Intended validation plan:

- Add a CLI source action-execution contract that maps shared slash command descriptors to gateway action names, parses safe terminal arguments, scopes execution to the selected owner and active session, and normalizes results through shared command-result descriptors.
- Implement fake and local source action execution for `/status`, `/compact`, `/clear`, `/abort`, `/kill`, `/kill-all`, `/fast`, `/session-current`, `/sessions`, and `/clone`, including local source equivalents or explicit unsupported results when no routed runtime is available.
- Update Ink command handling so supported Web/session slash actions render shared command result descriptors; `/clear` keeps local display clearing while also running the routed/source action; `/clone` opens/selects a derived session when a result returns one.
- Add focused source and Ink tests for successful routed actions, unsupported/runtime-error redaction, action-name mapping, metadata/session-list results, clone selection, and clear display behavior.
- Run `npm run build` plus focused tests in `pibo-dev-ink-cli-v2-web-parity`, then run PTY scripts for `/status`, `/fast`, `/session-current`, and `/clone` with raw/clean artifacts, followed by `npm run typecheck` and broader tests if practical.

Validation and results for routed slash action execution batch:

- Added `CliSessionSource.executeSlashCommand()` and source implementations for routed/shared slash action execution. The local source maps shared catalog descriptors to gateway action names and executes `/compact`, `/clear`, `/abort`, `/kill`, `/kill-all`, `/fast`, and `/clone` through the routed local runtime when available; `/status`, `/session-current`, and `/sessions` have source-equivalent paths scoped to the selected owner/open room/session without starting unnecessary runtime work.
- Ink command handling now renders normalized shared command result descriptors for Web/session commands. `/clear` still clears the local display after executing the source/routed action. `/clone` opens/selects the returned derived Pibo session id when the action result supplies one, and local source upserts navigation metadata for an existing derived session.
- Fake and debug PTY sources now support deterministic action fixtures for success, unsupported, and runtime-error/redaction cases, including an explicit debug-router `/clone` unsupported reason.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-session-app.test.mjs test/cli-session-source.test.mjs test/session-ui-view-models.test.mjs'` — passed 44/44 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-routed-actions --timeout-ms 70000 --idle-timeout-ms 15000 --cols 140 --rows 44 --wait-for "Select room for Web user action" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/status" --press Enter --wait-for "Status: source=local/direct" --expect "owner=Web user action (user:action)" --type "/fast" --press Enter --wait-for "fast:" --expect "mode" --expect "fast" --type "/session-current" --press Enter --wait-for "session-current:" --expect "New CLI session" --type "/clone" --press Enter --wait-for "Debug PTY mocked router cannot clone" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-routed-actions-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:action node dist/bin/pibo.js tui:sessions --owner-scope user:action'` — passed.
  - PTY classification: real PTY-backed CLI/TUI path with `LocalCliSessionSource`, real temp `PiboDataStore`, and deterministic mocked local router/source; not live provider.
  - PTY artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-routed-actions/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-routed-actions/clean.txt`.
  - Observed PTY result: clean output shows `/status` rendered through the shared status descriptor, `/fast` rendered a routed action result with `mode`/`fast`, `/session-current` rendered the current `New CLI session` link, and `/clone` rendered the explicit mocked-router unsupported reason.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 508 tests; 507 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Path classification: source/unit integration path plus real PTY-backed CLI/TUI path with deterministic mocked local router/source. No Web DOM behavior changed, so browser checks were not required for this batch.
- Completed stories marked `passes: true`: PRD 05 `US-003`, `US-004`.
- Implementation commit: `9132d08` (`Execute Ink routed slash actions`).
- Next recommended group: PRD 06 `US-001` through `US-003` for the generic overlay stack plus `/thinking` and `/model` picker flows, or PRD 03 `US-005` if Web Compact Terminal descriptor consumption should be prioritized first.

## 2026-05-17 run: interactive overlay thinking and model batch

Selected story group:

- `prd_06_interactive_keyboard_flows.json` / `US-001` — Implement generic overlay stack for command menus.
- `prd_06_interactive_keyboard_flows.json` / `US-002` — Implement `/thinking` direct and picker flows.
- `prd_06_interactive_keyboard_flows.json` / `US-003` — Implement `/model` provider and model picker.

Intended validation plan:

- Add a small generic Ink overlay stack model that can host existing owner/room/session/agent pickers plus command-menu/detail/confirmation overlays without importing Web DOM/CSS dependencies.
- Wire `/thinking <level>` to validate and execute directly; wire `/thinking` to a keyboard picker using Web-parity thinking levels and routed/source action execution on selection.
- Wire `/model` to request the routed/source model menu, render disabled providers/models with reasons, select provider then model through nested terminal pickers, and apply through a terminal-safe action argument.
- Add focused reducer/view/command/source tests for overlay stack navigation, nested command menu back/cancel behavior, `/thinking` direct/picker flows, and `/model` provider/model menu flows.
- Run focused tests after build inside `pibo-dev-ink-cli-v2-web-parity`, run `pibo debug pty` scripts for `/thinking` and `/model` with raw/clean artifacts, then run `npm run typecheck` before committing.

Validation and results for interactive overlay thinking and model batch:

- Implemented `InkOverlayState` with push/pop/active helpers and picker-backed overlay state for nested command menus, suggestions, future detail views, and confirmations. Existing owner/room/session/agent picker behavior remains compatible; Escape now backs from nested command pickers to their parent before canceling.
- Implemented `/thinking <level>` validation and direct source/routed execution for `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Implemented `/thinking` picker with `current/default` plus all supported levels; confirming a level executes the routed/source thinking action and refreshes status/result text.
- Implemented `/model` provider/model keyboard flow. The CLI requests the routed/source model menu, renders providers including disabled/unavailable providers with reasons, opens a nested model picker, and applies the selected model with a terminal-safe `provider/model` argument. `/model <provider>/<model>` executes directly and refreshes status.
- Added deterministic fake and debug PTY source/router fixtures for thinking and model menu/action results. Local source now serializes model action params as `{ provider, model }` when a terminal model selection is supplied.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-session-app.test.mjs test/cli-session-source.test.mjs test/session-ui-view-models.test.mjs'` — passed 47/47 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-thinking-model .tmp/pty-thinking-model-home && mkdir -p .tmp/pty-thinking-model-home && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-thinking-model --timeout-ms 80000 --idle-timeout-ms 15000 --cols 140 --rows 46 --wait-for "Select room for Web user flow" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/thinking high" --press Enter --wait-for "Thinking level set to high" --type "/thinking" --press Enter --wait-for "Select thinking level" --expect "current/default" --expect "xhigh" --press Down --press Down --press Down --press Down --press Down --press Enter --wait-for "Thinking level set to high" --type "/model" --press Enter --wait-for "Select model provider" --expect "OpenAI" --expect "Offline Provider" --press Enter --wait-for "Select model for OpenAI" --expect "GPT PTY Large" --expect "GPT PTY Mini" --press Down --press Enter --wait-for "Model set to openai/gpt-pty-mini" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-thinking-model-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:flow node dist/bin/pibo.js tui:sessions --owner-scope user:flow'` — passed.
  - PTY classification: real PTY-backed `pibo tui:sessions` path with `LocalCliSessionSource`, temp `PIBO_HOME`, and deterministic mocked local router/source; not live provider.
  - PTY artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-thinking-model/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-thinking-model/clean.txt`.
  - Observed PTY result: clean output shows `/thinking high` result, `/thinking` picker with `current/default` and `xhigh`, selected `high`, `/model` provider picker with `OpenAI` and disabled `Offline Provider`, nested OpenAI model picker with `GPT PTY Large` and `GPT PTY Mini`, and final `Model set to openai/gpt-pty-mini`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && node --test test/cli-ui-session-app.test.mjs test/cli-session-source.test.mjs test/session-ui-view-models.test.mjs && npm run typecheck'` — passed focused tests and typecheck.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 511 tests; 510 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Path classification: shared/source/unit tests plus real PTY-backed CLI/TUI checks with deterministic mocked local router/source. No Web DOM behavior changed, so browser checks were not required for this batch.
- Completed stories marked `passes: true`: PRD 06 `US-001`, `US-002`, `US-003`.
- Implementation commit: `f98054b` (`Add Ink thinking and model command pickers`).
- Evidence/PRD update commit: `c2a853b` (`Record interactive command picker PRD evidence`).
- Next recommended group: PRD 06 `US-004` and `US-005` for `/login`, `/fork-candidates`, `/download`, and `/upload` terminal equivalents, then PRD 07 rendering/PTY validation stories.

## 2026-05-17 run: login and terminal file/fork command equivalents batch

Selected story group:

- `prd_06_interactive_keyboard_flows.json` / `US-004` — Implement `/login` terminal provider flow.
- `prd_06_interactive_keyboard_flows.json` / `US-005` — Define fork upload download terminal equivalents.

Intended validation plan:

- Reuse the command overlay stack to implement `/login` provider/auth-method keyboard selection from the source/routed login menu result, rendering OAuth URLs/completion instructions and safe API-key instructions without echoing secrets.
- Add deterministic fake/debug PTY source fixtures for login providers/methods, fork candidates, and terminal file command results.
- Implement terminal-safe `/fork-candidates`, `/download`, and `/upload` behavior as either keyboard-selectable candidates or explicit path-based/deferred unsupported command-result descriptors with clear reasons.
- Add focused source/Ink/shared result tests for login menu parsing, OAuth/API-key output, fork candidate listing/selection or unsupported result, and download/upload path/unsupported behavior.
- Run `npm run build` plus focused tests inside `pibo-dev-ink-cli-v2-web-parity`, then run `pibo debug pty` scripts for `/login` and fork/file commands with raw/clean artifacts, followed by `npm run typecheck` before committing.

Validation and results for login and terminal file/fork command equivalents batch:

- Implemented `/login` provider/auth-method keyboard flows using the shared command-menu overlay stack. `/login` now opens a provider picker, then an auth-method picker; device-code/OAuth selection executes the routed/source `login.start` path and prints URL/code/completion instructions; API-key selection returns safe instructions and does not collect or echo secrets.
- Implemented terminal-adapted `/fork-candidates`: without args it renders routed/source candidates as a picker, and selecting or passing an entry id attempts routed `session.fork`; the deterministic debug router returns a clear unsupported reason for fork state mutation.
- Implemented terminal path instructions for `/download <path>` and `/upload <path>`; missing path cases return explicit usage/unsupported reasons, and provided paths explain shell/server-path behavior without browser APIs or secret echoing.
- Added deterministic fake/debug PTY fixtures for login providers/auth methods, fork candidates, download, and upload; added focused source/Ink/shared descriptor tests.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-session-app.test.mjs test/cli-session-source.test.mjs test/session-ui-view-models.test.mjs'` — passed 49/49 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-login-flow .tmp/pty-login-flow-home && mkdir -p .tmp/pty-login-flow-home && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-login-flow --timeout-ms 80000 --idle-timeout-ms 15000 --cols 140 --rows 46 --wait-for "Select room for Web user login" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/login" --press Enter --wait-for "Select login provider" --expect "OpenAI (ChatGPT Plus/Pro)" --expect "OpenAI API" --press Enter --wait-for "Select auth method for OpenAI (ChatGPT Plus/Pro)" --expect "Device code / OAuth" --press Enter --wait-for "Open openai-codex login URL" --expect "PTY-1234" --type "/login openai/api_key" --press Enter --wait-for "API-key login requires secret input" --expect "will not echo" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-login-flow-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:login node dist/bin/pibo.js tui:sessions --owner-scope user:login'` — passed.
  - Login PTY classification: real PTY-backed `pibo tui:sessions` path with `LocalCliSessionSource`, temp `PIBO_HOME`, and deterministic mocked local router/source; no live provider credentials.
  - Login PTY artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-login-flow/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-login-flow/clean.txt`.
  - Observed login PTY result: clean output shows provider choices, `Device code / OAuth`, `Open openai-codex login URL`, `PTY-1234`, and safe API-key instructions.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-fork-file .tmp/pty-fork-file-home && mkdir -p .tmp/pty-fork-file-home && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-fork-file --timeout-ms 80000 --idle-timeout-ms 15000 --cols 140 --rows 48 --wait-for "Select room for Web user files" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/fork-candidates" --press Enter --wait-for "Select fork candidate" --expect "Fork from PTY prompt one" --expect "Fork from PTY prompt two" --press Enter --wait-for "Debug PTY mocked router cannot fork" --type "/download /tmp/report.txt" --press Enter --wait-for "Terminal download for /tmp/report.txt" --expect "scp" --type "/upload /tmp/input.txt" --press Enter --wait-for "Terminal upload for /tmp/input.txt" --expect "~/.pibo/uploads" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-fork-file-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:files node dist/bin/pibo.js tui:sessions --owner-scope user:files'` — passed.
  - Fork/file PTY classification: real PTY-backed `pibo tui:sessions` path with `LocalCliSessionSource`, temp `PIBO_HOME`, and deterministic mocked local router/source; no fake app/demo path and no live provider.
  - Fork/file PTY artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-fork-file/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-fork-file/clean.txt`.
  - Observed fork/file PTY result: clean output shows fork candidate picker entries, explicit debug-router fork unsupported reason, terminal download instructions for `/tmp/report.txt` including `scp`, and terminal upload instructions for `/tmp/input.txt` including `~/.pibo/uploads`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 513 tests; 512 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Completed stories marked `passes: true`: PRD 06 `US-004`, `US-005`.
- Implementation commit: `33ea4db` (`Add Ink login and fork file command flows`).
- Next recommended group: PRD 07 `US-001` and `US-002` for rich Ink descriptor/status rendering, with PTY `/status` bar validation.

## 2026-05-17 run: rich Ink descriptor and status card rendering batch

Selected story group:

- `prd_07_web_parity_rendering_and_pty_validation.json` / `US-001` — Render rich shared descriptors in Ink.
- `prd_07_web_parity_rendering_and_pty_validation.json` / `US-002` — Render shared rich status card with bars.

Intended validation plan:

- Wire Ink transcript rendering through the shared `src/session-ui` terminal card/status descriptors for representative rich rows: user, assistant, reasoning, tool call/status, thinking, login, model, yielded-run, compaction, command, and error.
- Add terminal bar/status rendering for shared status descriptors, including unavailable-vs-zero progress semantics and redacted warnings/errors.
- Add snapshot-like Ink renderer tests for rich descriptor output and `/status` card output.
- Run focused tests after build inside `pibo-dev-ink-cli-v2-web-parity`.
- Run `pibo debug pty` for `/status` with raw/clean artifacts and assertions for owner, session, model/runtime, context/provider bars, and redacted sensitive text when available through deterministic local fixtures.
- Run `npm run typecheck` before committing; run broader tests if shared/renderer changes affect more than the focused paths.

Validation and results for rich Ink descriptor and status card rendering batch:

- Wired Ink transcript rendering through shared `buildTerminalCardDescriptor()` via a new `InkTerminalCard` renderer. Rich cards now render status, thinking, model, login, tool, yielded-run, compaction, command, and error descriptors with Web-aligned title/status/tone semantics, while user, assistant, and reasoning rows retain terminal-native row rendering.
- Improved shared card descriptor detail extraction so tool cards include function-call names/inputs and output-only cards have terminal detail rows; secret-shaped values remain redacted.
- `/status` now renders a shared rich terminal status card text built from `buildTerminalStatusViewModel()`, including owner, session/profile, model, runtime, queue/processing/streaming, cwd, thinking, fast mode, context and provider usage bars, warnings/errors, and redacted status messages.
- Local CLI status forwards runtime queued/processing/streaming/cwd/thinking/fast/context/provider/warning/error fields. The deterministic debug PTY router now supplies context/provider usage and redaction fixtures for `/status` validation.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-ink-renderer.test.mjs test/cli-ui-session-app.test.mjs test/session-ui-view-models.test.mjs test/cli-session-source.test.mjs'` — passed 56/56 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-rich-status .tmp/pty-rich-status-home && mkdir -p .tmp/pty-rich-status-home && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-rich-status --timeout-ms 70000 --idle-timeout-ms 15000 --cols 140 --rows 46 --wait-for "Select room for Web user status" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "/status" --press Enter --wait-for "Status: source=local/direct" --expect "Owner: Web user status (user:status)" --expect "Session: New CLI session" --expect "Runtime: local" --expect "Model: unknown" --expect "Context:" --expect "openai requests:" --expect "TOKEN=[redacted]" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-rich-status-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:status node dist/bin/pibo.js tui:sessions --owner-scope user:status'` — passed.
  - PTY classification: real PTY-backed `pibo tui:sessions` path with `LocalCliSessionSource`, temp `PIBO_HOME`, and deterministic mocked local router/source; no live provider credentials.
  - PTY artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-rich-status/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-rich-status/clean.txt`.
  - Observed PTY result: clean output shows `Status: source=local/direct`, `Owner: Web user status (user:status)`, `Session: New CLI session`, `Model: unknown`, `Runtime: local`, queue/processing/streaming/CWD rows, `Thinking: high`, `Fast mode: off`, a `Context` bar at 12.5%, an `openai requests` provider bar at 25.0%, and `TOKEN=[redacted]`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 515 tests; 514 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Path classification: shared renderer-neutral model additions, Ink renderer/unit path, and real PTY-backed CLI/TUI path with deterministic mocked local router/source. No Web DOM behavior changed, so browser checks were not required for this batch.
- Completed stories marked `passes: true`: PRD 07 `US-001`, `US-002`.
- Implementation commit: `d77b423` (`Render rich Ink terminal status cards`).
- Next recommended group: PRD 07 `US-003` and `US-004` for narrow/no-color PTY fallback checks and reusable `pibo debug pty` smoke scripts.

## 2026-05-17 run: narrow/no-color fallback and reusable PTY smoke scripts batch

Selected story group:

- `prd_07_web_parity_rendering_and_pty_validation.json` / `US-003` — Add narrow terminal and no-color fallbacks.
- `prd_07_web_parity_rendering_and_pty_validation.json` / `US-004` — Create reusable `pibo debug pty` smoke scripts.

Intended validation plan:

- Add/adjust terminal-safe Ink rendering helpers so narrow terminals preserve owner/session/error/active-command state with wrapping/truncation, and no-color output keeps explicit text markers.
- Add focused renderer tests for constrained width, no-color marker readability, and bounded transcript/card output.
- Add reusable documented PTY smoke scenarios under `scripts/` or `docs/reports/` for owner picker, room picker/session creation, message send, slash suggestions, `/status`, `/thinking` or equivalent interactive command, and `--session` transcript hydration; scripts must save raw/clean artifacts and use bounded timeouts.
- Run focused renderer/session-ui/debug PTY tests after build inside `pibo-dev-ink-cli-v2-web-parity`.
- Run at least one constrained-column/no-color `pibo debug pty` scenario with raw/clean artifacts and assertions.
- Run the reusable PTY smoke script in a quick deterministic mode and record generated artifact paths.
- Run `npm run typecheck`; run broader tests if these changes affect shared behavior beyond the focused CLI/validation paths.

Validation and results for narrow/no-color fallback and reusable PTY smoke scripts batch:

- Added a narrow-terminal Ink header fallback: constrained widths render separate bounded lines for source/mode, Owner, Session, and Agent/Model so owner/session state remains readable instead of being hidden in one truncated status line.
- Existing row/card rendering remains bounded by `maxLineChars`, `maxRows`, and explicit truncation; no-color output relies on visible text markers (`›`, `▣`, `↳`, `✕`) rather than color alone.
- Added reusable PTY smoke runner `scripts/ink-cli-v2-pty-smoke.mjs` with `--list`, `--dry-run`, `--scenario`, and `--artifact-root`. It runs bounded `pibo debug pty run` commands and writes raw/clean/screen/metadata/input/assertion artifacts.
- Added `docs/reports/ink-cli-v2-pty-smoke-scenarios.md` documenting scenarios and Ralph evidence requirements.
- Added `test/ink-cli-v2-pty-smoke.test.mjs` for scenario discovery, dry-run command construction, timeout/artifact flags, and documentation evidence rules.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/cli-ui-ink-renderer.test.mjs test/ink-cli-v2-pty-smoke.test.mjs test/debug-pty.test.mjs'` — passed 15/15 focused tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && rm -rf .tmp/pty-narrow-no-color .tmp/pty-narrow-no-color-home && mkdir -p .tmp/pty-narrow-no-color-home && npm run dev -- debug pty run --artifact --artifact-dir /workspace/.tmp/pty-narrow-no-color --timeout-ms 70000 --idle-timeout-ms 15000 --cols 44 --rows 26 --env NO_COLOR=1 --wait-for "Select room for Web user nar" --press Enter --wait-for "New session in Personal" --press Enter --wait-for "Created session" --type "/status" --press Enter --wait-for "Status: source=local/direct" --expect "Owner: Web user narrow" --expect "Session: New CLI session" --expect "Context:" --type "/th" --wait-for "Slash commands" --expect "/thinking" --expect "› /th" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-narrow-no-color-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_CLI_SESSIONS_OWNERS=user:narrow node dist/bin/pibo.js tui:sessions --owner-scope user:narrow'` — passed.
  - Narrow/no-color PTY classification: real PTY-backed `pibo tui:sessions` path with `LocalCliSessionSource`, temp `PIBO_HOME`, deterministic mocked local router/source, constrained columns, and `NO_COLOR=1`; no live provider credentials.
  - Narrow/no-color PTY artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-narrow-no-color/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-narrow-no-color/clean.txt`.
  - Observed narrow/no-color result: clean output shows split narrow header lines with `Owner: Web user narrow`, `Session: New CLI session`, rich `/status` owner/session/context fields, slash suggestions with `/thinking`, and active input `› /th`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && node scripts/ink-cli-v2-pty-smoke.mjs --scenario slash-suggestions-status-thinking --artifact-root .tmp/ink-cli-v2-pty-smoke-validation'` — passed.
  - Smoke script classification: reusable deterministic real PTY-backed `pibo tui:sessions` path with `LocalCliSessionSource`, temp `PIBO_HOME`, and mocked local router/source; not live provider.
  - Smoke script artifacts: raw `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/ink-cli-v2-pty-smoke-validation/slash-suggestions-status-thinking/raw.ansi.log`; clean `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/ink-cli-v2-pty-smoke-validation/slash-suggestions-status-thinking/clean.txt`.
  - Observed smoke script result: clean output shows room/session creation, slash suggestions while typing `/status` and `/th`, `/status` rich card with owner/context fields, `/thinking` picker with `xhigh`, and `Thinking level set to high`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && node --test test/cli-ui-ink-renderer.test.mjs test/ink-cli-v2-pty-smoke.test.mjs test/debug-pty.test.mjs && npm run typecheck'` — passed focused tests and full typecheck.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm test'` — ran 520 tests; 519 passed and only the pre-existing unrelated `test/telemetry-store.test.mjs` stale/prune assertion failed.
- Path classification: Ink renderer/unit path plus real PTY-backed CLI/TUI checks with deterministic mocked local router/source. No Web DOM behavior changed, so browser checks were not required for this batch.
- Completed stories marked `passes: true`: PRD 07 `US-003`, `US-004`.
- Implementation commit: `dd6b70433e48a080cc2229dab378611c836e4990` (`Add Ink PTY fallback smoke scripts`).
- Next recommended group: PRD 03 `US-005` Web Compact Terminal shared descriptor consumption, then PRD 07 `US-005` final installed CLI/Web parity validation.

## 2026-05-17 run: Web compact terminal descriptor consumption and final validation batch

Selected story group:

- `prd_03_shared_terminal_view_model_v2.json` / `US-005` — Wire Web Compact Terminal to shared descriptors without behavior regression.
- `prd_07_web_parity_rendering_and_pty_validation.json` / `US-005` — Final Web parity and installed CLI validation.

Intended validation plan:

- Wire at least one Web Compact Terminal rich-card path to `src/session-ui` shared descriptors, starting with the status card because Ink already consumes the same status descriptor and `/status` has rich parity evidence.
- Keep Web DOM rendering separate and thin; do not import Web components into Ink or DOM/CSS/browser modules into `src/session-ui`.
- Add focused static/shared tests proving the Web status card imports and consumes shared terminal card/status descriptors and no CLI renderer imports Web DOM/CSS/browser dependencies.
- Run focused shared/Web parity tests after build in `pibo-dev-ink-cli-v2-web-parity`.
- Run `npm run chat-ui:typecheck`, `npm run chat-ui:build`, and `npm run typecheck` for Web-impacting changes.
- Run reusable real PTY smoke script and installed/built package `pibo tui:sessions` via `pibo debug pty`, with raw/clean artifacts, then query the temp store for selected-owner Web navigation/read-model visibility.
- Run `npm test` and record whether the known telemetry prune failure still blocks full suite completion.
- Update PRD JSON story notes with command evidence, artifact paths, observed results, and commit hash, then commit the coherent final batch from the host worktree.

Validation and results for Web compact terminal descriptor consumption and final validation batch:

- Wired the Web Compact Terminal status card to consume shared renderer-neutral `src/session-ui` descriptors through `buildTerminalCardDescriptor(row)` and `statusView`. The Web renderer still owns DOM/CSS styling, but shared status title, fields, context progress, and descriptor hooks now drive the status rich-card path.
- Added static/source regression coverage in `test/session-ui-view-models.test.mjs` proving the Web status card imports shared descriptors and `src/apps/cli-ui` does not import Web compact-terminal, React DOM, CSS module, `window`, or `document` dependencies.
- Fixed the telemetry retention prune regression that had been blocking full `npm test`: provider-request counter updates now preserve `updatedAt` as the provider event receive time, so stale diagnostic provider requests remain prunable instead of being refreshed to wall-clock time.
- Focused validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/session-ui-view-models.test.mjs test/session-ui-terminal-rows.test.mjs'` — passed 10/10 focused shared/Web parity tests.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run chat-ui:typecheck && npm run chat-ui:build && npm run typecheck'` — passed; `chat-ui:build` emitted only existing Vite chunk-size warnings.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build >/tmp/pibo-build.log && node --test test/telemetry-store.test.mjs test/session-ui-view-models.test.mjs'` — passed 17/17 focused tests, including the previously failing telemetry stale/stats/prune case.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck && npm test'` — passed full typecheck and 521/521 tests.
- Installed CLI PTY validation:
  - Command: `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm install -g . >/tmp/pibo-install-global.log && rm -rf .tmp/pty-installed-final .tmp/pty-installed-final-home && mkdir -p .tmp/pty-installed-final-home && pibo debug pty run --artifact --artifact-dir /workspace/.tmp/pty-installed-final --timeout-ms 90000 --idle-timeout-ms 18000 --cols 140 --rows 46 --wait-for "Select room for Web user final" --expect "Personal Chat" --press Enter --wait-for "New session in Personal Chat" --press Enter --wait-for "Created session" --type "Installed PTY visible in Web" --press Enter --wait-for "Installed assistant final" --expect "Message sent" --press CtrlC -- env PIBO_HOME=/workspace/.tmp/pty-installed-final-home PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1 PIBO_DEBUG_PTY_ASSISTANT_REPLY="Installed assistant final" pibo tui:sessions --owner-scope user:final'` — PTY passed.
  - Classification: installed global `pibo` command, real PTY-backed `pibo tui:sessions` path with `LocalCliSessionSource` and real temp `PiboDataStore`; deterministic mocked local router/source only to avoid live provider credentials.
  - Raw artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-installed-final/raw.ansi.log`.
  - Clean artifact: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity/.tmp/pty-installed-final/clean.txt`.
  - Observed clean output: `Web user final (user:final)`, `Personal Chat`, `+ New session in Personal Chat`, `Created session`, user message `Installed PTY visible in Web`, assistant reply `Installed assistant final`, and `Message sent`.
- Store/Web read-model verification:
  - Queried `/workspace/.tmp/pty-installed-final-home/pibo.sqlite` after the installed PTY run.
  - Confirmed session `ps_81d9f8a4-20c7-43bd-9e70-ed91e0c76d22` has `owner_scope=user:final`, `room_id=room_0cdb603e-c6fc-4ae7-8ae9-d01e671aa1db`, matching `session_navigation` owner/room/status `idle` and `last_message_preview=Installed assistant final`, plus user and assistant `chat_messages` and `event_log` rows in the same room.
  - Web URL for manual/API verification: `http://127.0.0.1:4822/apps/chat/rooms/room_0cdb603e-c6fc-4ae7-8ae9-d01e671aa1db/sessions/ps_81d9f8a4-20c7-43bd-9e70-ed91e0c76d22`.
- Path classification: Web DOM renderer path consuming shared renderer-neutral descriptors; shared/unit/static tests; installed global CLI real PTY path with deterministic mocked local router/source and real local persistence.
- Completed stories marked `passes: true`: PRD 03 `US-005`; PRD 07 `US-005`.
- Implementation commit: `d6b68449aca7f67c6c49f73a510348cfe57504e7`.
