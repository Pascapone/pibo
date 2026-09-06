---
type: "Validation Report"
title: "Room creation ownership validation — September 6, 2026"
description: "Records optimistic Room preservation, navigation ownership, selective rollback, and exact-candidate headful Pibo2 acceptance."
tags: ["rooms", "sessions", "navigation", "performance"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-06T04:10:00Z"
sources:
  - id: "code"
    resource: "scope:Commit cb4f4e7e6121eab0193ff0db84a1cd938cba219a"
    title: "Accepted App and bootstrap mutation implementation"
  - id: "local"
    resource: "/reports/artifacts/room-creation-ownership-2026-09-06/local-parent.json"
    title: "Headful parent regression observations"
  - id: "acceptance"
    resource: "/reports/artifacts/room-creation-ownership-2026-09-06/acceptance.json"
    title: "Public authenticated desktop/mobile trusted-pointer acceptance"
  - id: "active"
    resource: "/reports/artifacts/room-creation-ownership-2026-09-06/active-acceptance.json"
    title: "Room workflows during real Spark tool execution and Queue"
  - id: "streaming"
    resource: "/reports/artifacts/room-creation-ownership-2026-09-06/streaming.json"
    title: "Coordinated real-stream native benchmark"
  - id: "events"
    resource: "/reports/artifacts/room-creation-ownership-2026-09-06/events-and-check.txt"
    title: "Persisted input/lifecycle events, trace check, and idle gateway status"
  - id: "reload"
    resource: "/reports/artifacts/room-creation-ownership-2026-09-06/reload.json"
    title: "Reloaded timeline, visible output, model, and browser bundle checksum"
---

# Result and scope

Issue #936 is addressed: a pending Room creation retains its optimistic selection, a later Room/Session choice or Browser Back owns navigation, and failure removes only that creation's temporary Room. POST completion releases creation controls without awaiting Room navigation hydration.[^code]

The exact candidate passed **22 public-path desktop/mobile cases**, plus **three Room workflows during active Spark tool execution with one queued message**. This does not establish overall Session/Room/Terminal performance completion. The independent Session-creation fix in PR #934 and other pending performance changes are not included. No merge, release, or controller deployment was performed.

# Parent reproduction and cause

The isolated Docker parent was `b3bda5ef0a61ff93babeae6f3e91b59c02e41a28`. Headful Browser Use Chrome and CDP used the real worker gateway/dev-auth flow. Successful response gates retained the actual server response after a real Room POST or navigation request; failure injection rejected before sending POST.

- While POST waited, the optimistic Room disappeared and the old Session returned without user input. The helper changed cached bootstrap selection to a temporary Room while the route still named the origin; route reconciliation reloaded that origin.
- After a later Room choice or actual same-document Browser Back, successful creation unconditionally selected its own Room, reversing the newer choice.
- Failure restored a whole bootstrap snapshot and old selection. Bounded RAF observations caught a brief old-Session remount before route reconciliation recovered. This is not proof of painted cross-Session content or persisted data loss.
- Creation controls remained disabled while post-success navigation was held, preventing another New Room action.

All ten expanded parent scenarios failed their relevant assertions. The repeated-creation case stopped at the disabled control, not at a missing server-created record. Local failure fixtures are intentionally not provider or reload-persistence evidence.[^local]

# Implementation boundary

The App keeps temporary selection in local UI state while cached bootstrap selection remains persisted. Only the Room list receives the optimistic insert. Explicit selection and route changes invalidate creation ownership. Previous navigation is cancelled/invalidated before insertion; focus refresh does not query a temporary Room ID.

Success reconciles the persisted Room but selects it only while still owned. Hydration runs in the background with request-scoped error handling. Failure removes the temporary ID without restoring unrelated cached data; it restores local selection only while owned. Room navigation also checks bootstrap request generation before a late callback navigates.

Replacement handles a temporary row removed by intervening navigation and a real Room already fetched in the meantime. It preserves newer existing metadata and avoids duplicates. Unit assertions cover missing-row insertion, deduplication, newer names, and unchanged unrelated Session/selection data.[^code]

# Exact candidate

- Code: `cb4f4e7e6121eab0193ff0db84a1cd938cba219a`, npm package `1.7.2`.
- Docker-built archive SHA-256: `f8cbfe9d1eff96ecc2dabfeb2e7f5df4547eb4c6659347a0d1f75fb301b6b526`.
- Pibo2 runtime: `/opt/pibo-candidates/room-create-navigation/cb4f4e7e/runtime`.
- Full-seed slot-01 lease: `lease_cf04e8a3133a9cf140`; pool fingerprint `7d0542f5fe2d9797b7a0ac96d54d89e67da22314298acd6af1ca322eefe0bbfc` is not the archive hash.
- Browser entry `index-DWyQXeS2.js` matched archive SHA-256 `1b392c4c95777211ad160a14e4b26946d607a999307fb25b409747aa0de2a652`.
- Official Machine Auth helper authenticated the existing supervised headful browser. Browser Use handled navigation; Chrome DevTools/CDP provided trusted pointer input, DOM/viewport checks, timing, native streaming observation, and console evidence.

# Pibo2 navigation and responsiveness

At **1431×908** and **390×844**, each viewport covered ordinary creation, pending POST untouched/other Room/Back with success and injected failure, and held navigation untouched/other Room/Back/repeated creation: **11 cases per viewport**.

All captured button clicks were trusted pointer events. Nonempty targets used actual persisted Spark replies, required viewport intersection and an occlusion hit test, and remained visible after release. New empty Sessions instead required their persisted Room/Session identity and route; a mounted root was not presented as nonempty-content readiness.

Across cases with an expected nonempty identity, **1,381 post-release RAF samples had zero wrong Session IDs**. RAF sampling is not a guarantee about every painted frame. Creation controls remained usable while navigation hydration was held. The retained optimistic Room was required to be visibly present in untouched pending-POST cases.[^acceptance]

A visible optimistic row was sampled **19.2–33.9 ms after the initial New Room click in 19 of 22 cases**. The remaining three did not capture that short-lived intermediate row. These are instrumented bounded feedback observations, not population percentiles or paired remote speedup estimates. There were **zero Long Tasks** in the accepted 22-case matrix. Fault/response gates amplify races; they do not measure ordinary server latency.

[Mobile POST/Back result](/reports/artifacts/room-creation-ownership-2026-09-06/mobile-post-back.png) · [Mobile hydration/Back result](/reports/artifacts/room-creation-ownership-2026-09-06/mobile-hydration-back.png).

# Real streaming, Queue, and persistence

Three setup Sessions explicitly used `rt-pi-spark`. Every actual submission verified `openai-codex/gpt-5.3-codex-spark`. Seven real turns ran in total: three target replies, two streaming responses, and one tool/Queue pair. No historical Session or other model was prompted. Untouched newly created empty Sessions were not prompted.

During `sleep 20; echo PB_ROOM_TOOL_COMPLETE`, a queued reply waited in the original Session while three mobile Room workflows ran: held-POST other Room, held-POST Back, and repeated creation during held navigation. Each workflow began with processing **true**, queue depth **1**, and the verified Spark model. All passed; **256 further post-release frames** and zero Long Tasks were recorded.[^active]

Queue accepted **September 6, 2026, 04:00:06.132 UTC**. The predecessor finished **04:00:26.751**, and the queued turn started **04:00:26.759**: **8 ms drain**. The deliberate tool wait is not dispatch delay. The originally reported intermittent ten-second Queue delay remains unreproduced.[^events]

The coordinated 18-second native benchmark captured **24 deltas / 4,020 bytes**, 32 overlay updates, 37 live computations totaling **4.9 ms**, and 16 Markdown renders totaling **73.8 ms**. RAF p99 was **16.8 ms**, maximum **33.4 ms**; no Long Tasks, warnings, or regressions were reported. This is scoped regression evidence, not a claim that this navigation patch accelerates Markdown or provider generation.[^streaming]

Full desktop reload retained all five source-Session assistant outputs in `inlinePayloads.output`, including both long streams and the tool/Queue replies. The final stream marker itself passed viewport and hit-test readiness. Native trace reconstruction contained **16 nodes, zero issues**. Final status showed Spark idle with queue zero; gateway status showed 15 idle runtimes, zero active yielded runs, and idle restart safety. Console inspection found no warnings/errors.[^reload][^events]

[Desktop reload](/reports/artifacts/room-creation-ownership-2026-09-06/desktop-reload.png).

# Validation limits and corrected instrumentation

- Exact-code Docker full build and all typechecks passed. Twelve focused tests passed, one browser test skipped by default; the separately enabled headful suite passed **11/11 Node tests** covering ten scenarios, including a final post-build repeat. Full repository suite was not run.
- Build monitors were PSI-stopped at 5.06 (parent) and 5.12 (candidate). Their independent Docker pipelines completed with explicitly verified exit zero. The monitors themselves failed.
- An early candidate omitted an import and failed failure scenarios; it was corrected before accepted local runs. An invalid workspace-typecheck invocation was not counted; the actual Chat typecheck and full typecheck passed afterward.
- An early remote harness marked the release phase in a separate CDP command before releasing the response, counting a still-pending frame. The accepted harness performs both atomically.
- A mobile harness attempted to click an already-closed sidebar's offscreen Close button. DOM geometry proved it closed; state-aware pointer handling corrected the harness. Desktop passes were retained, mobile rerun with the correction.
- The first streaming observer ended at **03:58:36.298**, before that stream's input was accepted at **03:58:37.039**. Its zero-delta output is retained but excluded. A distinct, explicitly submitted stream was coordinated with the observer in one shell and produced the accepted metrics above.
- Initial reload checking tested row presence before visibility settled; acceptance now waits for the exact marker's visible text range. An incorrect timeline URL returned an error and was corrected to `/api/chat/trace/timeline`; the accepted artifact contains actual timeline nodes, not an error response.
- No claims cover all Room rename/archive/workspace mutation races, full accessibility, other tab modules, historical scrolling, or integrated pending fixes. No timeout extension, forced visibility, or snapshot omission was used.
- Docs core/migration/index/log checks and 84 focused documentation tests passed in the worktree (Docker Git-metadata limitation). `npm run docs:validate` retains only three pre-existing missing screenshots in the September 5 Session-native workflow report. Missing evidence was not fabricated.
- Owned worker and lease were released after idle checks; lease release was **04:07:03.672 UTC**. Browser returned to canonical Pibo2. No gateway restart was attempted.

[^code]: Source `code`; scoped owner checks, cache reconciliation, selective rollback, and tests.
[^local]: Source `local`; paired raw parent and final candidate artifacts sit alongside it.
[^acceptance]: Source `acceptance`; complete requests, trusted input, RAF samples, and final visible state.
[^active]: Source `active`; processing/model/queue preconditions and three complete real-work scenarios.
[^streaming]: Source `streaming`; native counters and render/RAF observations.
[^events]: Source `events`; persisted lifecycle timestamps and native trace/safety inspection.
[^reload]: Source `reload`; exact browser bundle hash, timeline assistant output, and idle model status.
