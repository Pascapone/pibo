---
type: "Validation Report"
title: "Terminal viewport and wheel ownership validation — September 6, 2026"
description: "Records local regression and exact-candidate Pibo2 evidence for viewport shrink, coarse wheel input, history restoration, streaming, and queued delivery."
tags: ["terminal", "performance", "scrolling"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-06T00:20:00Z"
sources:
  - id: "measurements"
    resource: "/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/measurements.json"
    title: "Complete sampled browser measurements and target identities"
  - id: "events"
    resource: "/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/spark-events-and-check.txt"
    title: "Actual Spark accepted inputs, turn events, and trace checks"
  - id: "local"
    resource: "/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/local-headful-2.txt"
    title: "Second consecutive passing Docker headful regression run"
  - id: "code"
    resource: "scope:Commit f54d19061486f4db60da27b8f82f9629a0295157"
    title: "Exact validated scrolling implementation"
---

# Result and scope

Issues #928 and #930 are addressed by preserving the correct scroll owner in `useStickyVirtuoso`. The viewport is observed alongside its item list. Viewport-only resize follows the bottom when sticky, but does not replay detached anchors over native user movement. Coarse wheel input captures the new reading position and refreshes pending prepend/restoration anchors, preventing subsequent mutations from undoing that input.[^code]

This accepts these scrolling changes, not the entire Session/Room performance objective. Initial visibility, quota caching, and passive history activation fixes in PRs #929, #924, and #926 are independent and absent from this candidate. No merge, release, or controller deployment was performed.

# Exact candidate and method

- Code: `f54d19061486f4db60da27b8f82f9629a0295157`, based on `b3bda5ef0a61ff93babeae6f3e91b59c02e41a28`; package `1.7.2`.
- Locally built npm archive SHA-256: `eb3894c71beca257d2d618b5912bd6b0059c54fcae51ebd74e3d5e24c6405400`.
- Exact Pibo2 runtime: `/opt/pibo-candidates/terminal-viewport-resize/f54d1906/runtime`; full-seed lease `lease_2d7d46ebd7d9082a66`, slot-01. Pool runtime fingerprint `1b61845592ddbd8fb7997b507a70330ffbc3a5e485d0a95da909a875d553eea3` is not the archive checksum.
- Public HTTPS/Machine Auth, existing supervised headful Chrome, Browser Use screenshots and navigation, Chrome DevTools/CDP geometry, input, network, and console inspection. Acceptance spans September 5–6 UTC; the lease was released at `2026-09-06T00:12:32.243Z` after confirming idle runtimes and restoring the browser to canonical Pibo2.
- Largest Session: `ps_069cced9-7902-4b10-8bd6-279d7b98ece1`, 16,005 events. The matching 21,023,113-byte native transcript was copied into the isolated full seed before navigation; SHA-256 `c486c0f90709f4bc3061f7386cbf02e49c88c690adf490aa99b664a130c12d2c`. No prompt was sent to this historical Session.
- New real Session: `ps_309f16e4-9cf5-4877-90c5-168685086f75`, Room `room_9b442355-8a5a-4ddb-8977-95780e274f7d`. Explicit `rt-pi-spark` profile; status verified `openai-codex/gpt-5.3-codex-spark` before real submissions.

# Before and after

| Check | Before | Candidate |
|---|---|---|
| Docker external header growth, desktop/mobile | Persistent 30 px bottom gap | 0 px settled gap, both widths |
| Coarse mobile wheel, local unchanged-parent diagnostic | Direct 2751→2631 movement restored to 2751 before RAF | Approximately 120 px retained movement, no kickback |
| Natural mobile header hydration, large Pibo2 history | Parent viewport 547→517 px; scrollTop unchanged; persistent 30 px gap | Same 30 px shrink advances scrollTop by 30 px; final gap 0 in all three returns |
| Real Spark reply, controlled viewport resize | No matched remote before measurement | 0 px settled bottom gap and 0 px detached-anchor drift, desktop/mobile |
| Real Spark reply, wheel during resize | No matched remote before measurement | 120 px movement; 0 px kickback, both widths |

Parent mobile data comes from the previously captured unchanged `b3bda5ef` Pibo2 slot, not a concurrent new baseline. Candidate natural-header samples each contained one intermediate RAF observation of the 30 px gap; correction was present in the next sample, 4.6–25.4 ms later. These are geometry samples, not proof that every sampled intermediate state was painted. The claim is removal of the persistent gap, not zero-frame resize settlement.[^measurements]

Local headful regression uses real supported streaming fixtures with 12 prelude messages and an 80-paragraph Markdown body. A flex spacer outside the scroller simulates header growth without forcing item dimensions. It checks bottom-follow, detached anchors through 0/30/60 px changes, and real wheel input concurrent with resize. Desktop viewport 595→565 px and mobile 525→495 px both retain the bottom. Three tests passed twice consecutively.[^local]

# History, streaming, and queue evidence

- Large-history wheel detachment, switch away/back, and full reload preserved the saved reading target. All **255 visible reload samples** contained the saved row, with **0 px offset drift**.
- A real older-page request (`before=15906`, limit 100) was held in flight with **500 ms artificial CDP network latency**. A subsequent downward coarse wheel advanced the reading target during that request; the retained anchor drifted only **0.28125 px** after prepend. Artificial latency was removed in `finally`; it is race amplification, not a server performance measurement.
- Pibo2 controlled interaction ran at 1431×844 and 390×844; large-history desktop reload used 1431×908. The actual Spark reply contained 80 numbered paragraphs and a completion marker. Both widths preserved detached anchors across viewport changes and retained exactly 120 px concurrent wheel movement.
- Native 18-second streaming observation: **22 text deltas / 3918 bytes**, 27 overlay updates, 31 live computations totaling **3.2 ms**, and 21 Markdown renders totaling **89.8 ms**. **Zero Long Tasks**, no benchmark warnings or regressions. Operator delay before submission is not TTFT.
- A real second turn requested `sleep 20; echo PB_VIEWPORT_TOOL_COMPLETE`; explicit Queue was used while processing. Queue accepted at `2026-09-06T00:00:40.769Z`; predecessor finished at `00:01:00.685Z`; queued turn started at `00:01:00.696Z`: **11 ms drain gap**. Waiting for the requested tool is not dispatch lag. Sidebar switching was also exercised around this wait.
- Stream, tool-turn, and queued-reply markers survived full navigation reload. Native trace checks reported **zero issues**; DevTools reported no console errors or warnings. Final slot status showed both runtimes idle with no queued work or active yielded runs.[^events][^measurements]

# Reproduction and evidence

Committed local regression: `test/chat-ui-terminal-viewport-resize.test.mjs`, opt-in with `PIBO_TEST_CDP_URL`, restricted to authenticated local Docker workers. Run it headful after building the candidate. Static ownership guards are in `test/use-sticky-virtuoso.test.mjs`.

Published artifacts include [measurements](/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/measurements.json), [external-resize interaction probe](/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/interaction-probe.mjs), [natural-header probe](/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/resize-probe.mjs), and [in-flight prepend probe](/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/prepend-probe.mjs). Operator probes retain their run-specific paths and Session IDs; acquire a fresh isolated lease and substitute its own authenticated target and IDs before reuse. They are evidence, not portable production automation. Text-log trailing whitespace was normalized; structured measurement values were preserved.

Visual evidence: [mobile queued tool](/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/mobile-queued-tool.png), [large-history reading](/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/large-history-reading.png), and [desktop reload](/reports/artifacts/terminal-viewport-and-wheel-2026-09-06/desktop-reload.png).

# Validation limits and corrected attempts

- Full Docker build, all typechecks, and 85 focused tests passed; one opt-in browser test was skipped in that run and separately executed headful. The full repository suite and integrated release gates were not run.
- Simply observing the viewport first introduced detached desktop wheel kickback. The final observer gating avoids replaying anchors on viewport-only detached changes. The separate pre-existing coarse-wheel rollback was reproduced even without concurrent resize, then fixed by refreshing pending targets.
- The first remote interaction script clicked Scroll to latest before responsive layout settled and failed its mobile initial-bottom precondition. After waiting for that layout before the explicit user action, both widths passed. This is not evidence of automatic bottom-follow after a detached viewport change.
- The tool submission's CDP evaluation returned `Promise was collected`. The following Queue action independently verified the model and active processing state; native events subsequently confirmed exactly one complete tool prompt and one complete queued prompt. The tool submission was not retried. Successful streaming submission had no such evaluation error.
- Eight actual status actions measured 427.5–640.1 ms in this independent parent-based candidate. No status-latency improvement is claimed here; that remains the separate #924 work.
- An earlier local build monitor was PSI-stopped; its independent Docker process exited 0. The final build monitor completed normally. Diagnostic controls, failed preconditions, and superseded attempts are excluded from pass counts.
- The reported intermittent ten-second queue delay remains unreproduced. These limited observations do not establish population percentiles, all creation/optimistic races, or overall performance completion.
- Documentation core/migration/index checks and 84 focused documentation tests passed in the worktree (Docker Git-metadata limitation). Strict validation retains the three pre-existing missing screenshots in `session-native-workflow-transition-validation-2026-09-05.md`; missing historical artifacts were not fabricated.

[^measurements]: Source `measurements`; complete sampled frame arrays, request timings, benchmark output, and target identities.
[^events]: Source `events`; accepted input text, exact turn timestamps, and native trace reconstruction checks.
[^local]: Source `local`; second passing headful Docker run, with first run, baseline failure, build, typecheck, and focused-test logs alongside it.
[^code]: Source `code`; viewport observation, detached resize gating, and coarse-wheel pending-anchor refresh in `useStickyVirtuoso`.
