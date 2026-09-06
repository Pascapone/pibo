---
type: "Validation Report"
title: "Room edit ownership validation — September 6, 2026"
description: "Records Room edit and archive navigation safety, field-scoped optimistic updates, and exact-candidate Pibo2 acceptance."
tags: ["rooms", "sessions", "navigation", "performance"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-06T06:12:00Z"
sources:
  - id: "code"
    resource: "scope:Commit da91ca265c6baa16a4f19f29d2036c3c6ddc56a0"
    title: "Accepted Room edit implementation and regression tests"
  - id: "local"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/local-parent.json"
    title: "Expanded headful parent regression observations"
  - id: "staleness"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/local-natural-staleness.json"
    title: "Ordinary ungated local background edit observation"
  - id: "acceptance"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/acceptance.json"
    title: "Thirty public TLS/Auth desktop and mobile cases"
  - id: "workspace"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/workspace.json"
    title: "Room workspace and topic changes with real Spark execution"
  - id: "active"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/active-confirmed.json"
    title: "Room mutations during real tool execution and queued delivery"
  - id: "streaming"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/streaming.json"
    title: "Native eighteen-second real streaming benchmark"
  - id: "live-edit"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/live-edit.json"
    title: "Overlapping Room edits during a larger real stream"
  - id: "history"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/history.json"
    title: "Large-history reading anchor during a background Room edit"
  - id: "events"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/events-and-check.txt"
    title: "Persisted lifecycle events, native trace checks, and idle status"
  - id: "reload"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/reload.json"
    title: "Reloaded assistant outputs, visible marker, and served bundle identity"
  - id: "telemetry"
    resource: "/reports/artifacts/room-edit-ownership-2026-09-06/telemetry.json"
    title: "Bounded native turn and provider-request metadata"
---

# Result and scope

Issue #938 is addressed at the checked candidate: Room name, topic, workspace, archive, and restore updates no longer perform unrelated full-bootstrap hydration or navigate back to a captured selection. Field-scoped optimistic settlement preserves other Rooms, newer navigation, Session content, hierarchy, and unrelated summary metadata. Overlapping tracked edits handle either response order and double failure without retaining a never-saved optimistic name.[^code]

**Thirty public-path desktop/mobile cases passed**, supplemented by real workspace execution, tool/Queue activity, live-stream edits, large-history reading, and reload persistence. This is scoped acceptance, not completion of the broader Session/Room/Terminal performance goal. Independent creation fixes in PR #934 and #937 and other pending performance changes are not integrated into this candidate. No merge, release, or controller deployment occurred.

# Parent reproduction

The isolated Docker parent was `b3bda5ef0a61ff93babeae6f3e91b59c02e41a28`.

- Editing background Room B while viewing Room A successfully PATCHed B, then requested bootstrap with B's Room ID and A's Session ID. The resulting **404** caused whole-bootstrap rollback, visually undoing a persisted edit.
- In one ordinary, ungated local observation, PATCH completed in **23.1 ms**, but the correct name returned only **29,922.8 ms after PATCH began**, near the unchanged 30-second navigation fallback. This is a local sample, not a paired Pibo2 speedup.[^staleness]
- Delayed actual PATCH responses overrode a later Session choice, other Room choice, or same-document Browser Back. Five bare-probe edit/archive cases recorded 94–95 wrong-Session RAF samples each.
- An injected failure before sending A's PATCH restored an entire snapshot, removing a newer successful name for B from the UI.
- A delayed earlier success briefly replayed an older name after a second rename had succeeded.

**Eleven of twelve expanded parent scenarios failed**; newer-first double failure passed. Synthetic local message fixtures can trigger summary refresh and heal stale names. Consequently, some expanded parent failures concern unnecessary bootstrap requests rather than persistent name loss; the bare staleness/failure probes are separate evidence. The crossed-read parent case failed the fresh-read assertion, not the identity assertion.[^local]

# Implementation and regression boundary

`App.tsx:updateRoom` applies Room PATCH results without navigation or full-bootstrap loading; archive/restore uses the same path. `RoomMutationTracker` records pending layers only for edited fields. Success applies normalized values for those fields; failure removes its layer. Completed fields independently stop overriding fresh data. Other Room fields, children, unread summaries, Session data, and selection remain intact. Explicit workspace clearing updates both the projected field and `metadata.workspace`.[^code]

Pending fields replay across bootstrap/navigation overlays. A first prototype still failed warmed Session navigation because cached metadata replaced the saved name. The accepted code invalidates Session navigation cache at mutation start and settlement. Reads crossing a Room mutation retry fresh metadata without changing their navigation intent. It does not cancel the later selection by advancing bootstrap ownership, raise a timeout, change the fallback interval, or force content visibility.

The server's concurrent-write policy is unchanged. These tests reorder responses after actual writes or reject before sending. They do not prove reversed request delivery, multi-client same-field conflict resolution, or transport failure after a server commit. Pin, reorder, read-all, and other mutation families retain independent behavior.

# Exact candidate and local gates

| Identity | Value |
|---|---|
| Accepted code | `da91ca265c6baa16a4f19f29d2036c3c6ddc56a0` |
| Package | `1.7.2`, built and packed in the isolated Docker worker |
| Archive SHA-256 | `7bcdf1ff55656a9fb0cab4ca7f50e2b0ea80e6bb5a219d2ce8b9f5312506927a` |
| Pibo2 runtime | `/opt/pibo-candidates/room-edit-ownership/da91ca26/runtime` |
| Full-seed lease | `lease_6a0c7e6b33fa05a693`, slot-01 |
| Pool fingerprint, not archive hash | `937920907ce9460c3dc901487bb81fc22b060a6534b4407b91edced50577f11b` |
| Browser asset | `index-DqIB5bdl.js` |
| Served and archive JS SHA-256 | `5e2b595a36875f5f53b92ad9320de4a93b978ccbaed5ac87defc398b01db7c28` |

Full build and all typechecks completed with explicit exit zero. The focused run passed **19 tests**, with one opt-in browser test skipped. The enabled headful suite passed **13/13 Node tests covering twelve scenarios**, including a final repeat after the full build: 961 identity samples and nine visible, hit-tested local fixture checks. Seven unit tests include all eight completion-order/success/failure combinations, clearing, unrelated data retention, and independent field settlement.

Reproduction entry points:

```sh
npm run build
npm run typecheck
node --test test/chat-ui-room-mutations.test.mjs
PIBO_TEST_CDP_URL=<authenticated-worker-cdp-url> \
  node --test test/chat-ui-room-mutation-navigation-race.test.mjs
```

The first build monitor was PSI-stopped at 5.83; its independent Docker build explicitly completed zero. The final parent/candidate pipeline separately recorded parent regression exit one and candidate build/type/focused/headful exits zero. No failed monitor was counted as successful. The full repository suite was not run.

# Public-path navigation and responsiveness

Official Machine Auth authenticated the existing supervised headful Pibo2 browser. Browser Use and Chrome DevTools/CDP supplied browser inspection, trusted pointer/keyboard form input, actual history navigation, network/DOM evidence, screenshots, and performance observation.

At **1431×908** and **390×844**, fifteen cases per viewport covered ordinary background/current edits; later Session, Room, and Back; failure with another Room's successful edit; overlapping successes; archive/restore; warm Session cache; crossed navigation; both double-failure orders; and failed rename overlapping archive. Successful gates held real responses; injected failures occurred before sending their requests.

All thirty passed with actual persisted Spark target replies visible and unoccluded. **3,512 post-release RAF samples** contained no wrong Session identity. No full-bootstrap request occurred within these instrumented metadata workflows. Sampling does not prove every painted frame.[^acceptance]

| Ordinary case | First correct visible name after trusted submit | PATCH duration |
|---|---:|---:|
| Desktop background Room | 22.2 ms | 63.2 ms |
| Desktop current Room | 20.8 ms | 22.6 ms |
| Mobile background Room | 19.6 ms | 22.4 ms |
| Mobile current Room | 15.4 ms | 17.9 ms |

No name reversion followed first correct visibility within those observation windows. These four measurements are not population percentiles. Artificial response gates are race amplification, not ordinary server latency. A **53 ms Long Task** occurred in the desktop archive/Session case; the thirty-case matrix is not a zero-Long-Task result.

[Mobile Back result](/reports/artifacts/room-edit-ownership-2026-09-06/mobile-back.png).

# Workspace, live work, history, and persistence

Eight actual turns used **`openai-codex/gpt-5.3-codex-spark`**, verified before every submission: three target replies, one workspace `pwd`, one tool/Queue pair, and two streams. No historical or other-model Session was prompted.

Native form edits set the background Room's workspace to `/tmp` and updated its topic without switching the current Session. Its existing Session retained `/root`; a new Spark Session inherited `/tmp`, and actual `pwd` returned `/tmp`. Clearing Room workspace/topic preserved that Session's `/tmp`; another new Spark Session reverted to the `/root` default. The actual reply persisted.[^workspace][^reload]

During `sleep 20`, processing remained true with queue depth one across Room rename/switch and source-Room archive/restore. Queue accepted **September 6, 2026, 05:29:08.720 UTC**; predecessor finished **05:29:29.262**, successor started **05:29:29.271**: **9 ms drain**. Native telemetry's slightly different boundaries yield 8 ms; the report consistently uses persisted event boundaries. The intentional tool wait is not dispatch latency. The originally reported intermittent ten-second drain remains unreproduced.[^active][^events][^telemetry]

The standalone 18-second native benchmark captured **22 deltas / 4,173 bytes**, 30 overlay updates, 36 live computations totaling **5.1 ms**, and 19 Markdown renders totaling **83.5 ms**. RAF p99 was **16.8 ms**, maximum **33.2 ms**; Long Tasks, warnings, and regressions were zero.[^streaming]

During the larger **15,945-byte** real stream, two Room PATCHes completed at delta counts **3 and 13 of 19**. Holding the first response while the second succeeded did not revert the later name or switch Session. Across 1,304 recorded frames, live computations totaled **3.0 ms**, and 25 Markdown renders totaled **156.7 ms**. **Two tail Long Tasks of 50/100 ms remain a performance investigation**, not a claimed fix.[^live-edit]

That longer turn started 14 ms after enqueue and lasted about 20.9 seconds. Its provider/harness telemetry window began at **05:35:12.244**; the browser's first text event arrived **05:35:30.150**, about 17.95 seconds after submission. This is not Queue drain. Metadata-only telemetry and an empty provider-event page cannot separate provider computation, network, and harness waiting.[^telemetry][^live-edit]

The 16,005-event historical Session retained its detached reading anchor while an owned background Room was edited: **94 same-Session samples**, anchor top **214.0625 px before and after**, no full bootstrap. The position was established with a programmatic scroll, not a trusted-wheel test. Its copied native transcript checksum remained unchanged.[^history][^events]

Hard reload retained all five source-Session assistant outputs, including both streams and tool/Queue replies. The final marker's exact text range was visible at **794.86–808.86 px**, inside the scroller ending at **843 px**. The workspace reply also persisted. Native reconstruction reported **16 nodes / zero issues**; five runtimes were idle, queues empty, and no yielded runs active. Console inspection reported no JavaScript error and one Chrome form-field id/name issue, not an empty console.[^reload][^events]

[Desktop reload](/reports/artifacts/room-edit-ownership-2026-09-06/desktop-reload.png).

# Instrumentation corrections and remaining limits

- The first remote selector also matched a sidebar ancestor carrying the selected Room ID; its trusted click opened Personal Chat actions. It was narrowed to the Room-node selector and menu readiness was added. No intended Room mutation occurred in those failed attempts.
- A nine-second observation helper expired before the deliberately twenty-second tool finished. The later Queue result and idle state were confirmed without retrying any prompt; the original observer error remains in the confirmed artifact.
- Reload parsing initially filtered `node.kind` instead of the API's `node.type`, producing an empty output list. Schema inspection corrected the harness; the retained failure is not evidence of data loss.
- A local fixture emitted after archive correctly returned 403. The accepted test emits it before archive. Synthetic local fixtures are not provider or reload evidence.
- Broader accessibility, all Room mutation families, reversed request delivery, multi-client writes, integrated pending fixes, and overall performance completion remain unproven.
- Documentation-only publication follows the already accepted code. Core, migration, generated-index, and log checks passed, as did all 84 documentation tests. Strict `npm run docs:validate` reports only the three pre-existing missing screenshots in the September 5 Session-native workflow report. Checks ran in the worktree because Docker lacks the required Git metadata; missing evidence was not fabricated.
- The owned worker and lease were released after idle checks, at **05:47:04.935 UTC** for the lease. The browser returned to canonical Pibo2; no gateway restart was attempted.

# Related contract and evidence

The scoped normative owner is [WEB-SHELL-ROOM-UPDATE-008](/specs/web/app-shell-bootstrap-navigation-and-pwa.md#requirement-web-shell-room-update-008-room-edits-preserve-navigation-and-unrelated-state). Raw local/remote observations, scripts, corrected-harness records, release proofs, and logs accompany this report in `artifacts/room-edit-ownership-2026-09-06/`. Text logs have trailing whitespace normalized; structured observations and screenshots retain their captured values. Replaying probes requires a new owned lease, newly generated fixture IDs, and the documented authenticated browser setup—not reuse of released IDs.

[^code]: Source `code`; App, field tracker, and named regression tests.
[^local]: Source `local`; paired parent and candidate logs and JSON accompany it.
[^staleness]: Source `staleness`; no response gate was used for this ordinary observation.
[^acceptance]: Source `acceptance`; trusted input, requests, visible replies, and frame samples.
[^workspace]: Source `workspace`; current/new Session workspace and profile results.
[^active]: Source `active`; active processing/queue checks and later completion confirmation.
[^streaming]: Source `streaming`; native counters, render order, warnings, and regression results.
[^live-edit]: Source `live-edit`; overlapping actual deltas, metadata settlement, and Long Tasks.
[^history]: Source `history`; historical identity, geometry, and request evidence.
[^events]: Source `events`; persisted lifecycle timestamps, trace checks, idle state, and transcript hash.
[^reload]: Source `reload`; actual timeline output, viewport geometry, and served asset hash.
[^telemetry]: Source `telemetry`; bounded request-window and turn metadata, not a complete transport trace.
