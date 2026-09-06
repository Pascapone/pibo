---
type: "Validation Report"
title: "Session creation ownership validation — September 6, 2026"
description: "Records exact-candidate local and Pibo2 evidence for nonblocking post-create hydration and preservation of later navigation."
tags: ["sessions", "navigation", "performance"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-06T02:10:00Z"
sources:
  - id: "dom"
    resource: "/reports/artifacts/session-creation-ownership-2026-09-06/dom-scenarios.json"
    title: "Fourteen public-path scenarios with full frame and network observations"
  - id: "pointer"
    resource: "/reports/artifacts/session-creation-ownership-2026-09-06/pointer-scenarios.json"
    title: "Eight additional trusted-pointer scenarios"
  - id: "events"
    resource: "/reports/artifacts/session-creation-ownership-2026-09-06/spark-events-and-check.txt"
    title: "Real Spark tool and queued turn events"
  - id: "local"
    resource: "/reports/artifacts/session-creation-ownership-2026-09-06/local-headful-2.txt"
    title: "Second passing local headful regression run"
  - id: "code"
    resource: "scope:Commit 029e413afc17ae46c36a7e021ce45610f6ea0ff4"
    title: "Accepted App creation and navigation implementation"
---

# Result and scope

Issue #932 is addressed: successful Session creation releases the creation lock after POST, without awaiting background bootstrap hydration. A later Session selection immediately invalidates older bootstrap ownership. Hydration cannot perform a second navigation; its rejected promise reports an error only while it still owns the request generation.[^code]

This is a focused post-POST ownership fix, not completion of the wider Session/Room performance goal. Pre-POST optimistic behavior remains unchanged. Room creation/rollback, arbitrary mutation races, and the intermittent ten-second Queue delay are not claimed solved. The separate quota, passive-history, initial-visibility, and viewport fixes in PRs #924, #926, #929, and #931 are absent from this parent-based candidate. No merge, release, or controller deployment was performed.

# Exact candidate and execution

- Checked code: `029e413afc17ae46c36a7e021ce45610f6ea0ff4`, based on `b3bda5ef0a61ff93babeae6f3e91b59c02e41a28`; npm package `1.7.2`.
- Locally built archive SHA-256: `22ff6da0143948c9005b964e7e7be0b3036e1daf7cec9caaa507f1c151251e62`.
- Exact Pibo2 runtime: `/opt/pibo-candidates/session-create-navigation/029e413a/runtime`; full-seed slot-01 lease `lease_c7fb8eba332096af19`. Pool fingerprint `f9efcd690c108da11a0e2e1c2e3db6f66eeb6bb163dd2819fd84c503f8751113` is distinct from the archive checksum.
- Executed browser entry `index-B7xqYtH-.js`; authenticated browser fetch and archived bundle both hash to `91220b807c521d5f7a5f057df8427fff7a757af7c691307cd32a34be07f54276`.
- Existing supervised headful Chromium, public HTTPS/Machine Auth, Browser Use navigation/screenshots and Chrome DevTools/CDP frame, occlusion, input, network, and console inspection. Desktop/mobile scenarios use 1431×908 and 390×844; the final desktop reload uses 1431×908.
- Two owned Rooms and three real response-bearing Sessions were prepared with explicit `rt-pi-spark`. Each real submission verified `openai-codex/gpt-5.3-codex-spark`; no historical Session was prompted. Native IDs and model checks are in `target-ids.json` and `real-spark-setup.json` beside the measurements.
- Owned Docker worker and Pibo2 lease were released after final idle and trace checks; lease release was `2026-09-06T02:04:14.423Z`. Browser returned to canonical Pibo2. No gateway restart was attempted.

# Regression and browser results

The parent reversed later selections when the real post-create bootstrap response was held and then released. An initial partial fix guarded sidebar navigation but still held `creatingSessionRef` through hydration: actual Browser Back remained suppressed and New Session stayed disabled. That partial candidate was rejected, returned to Docker, and never accepted on Pibo2.

Final local regression: six scenarios plus their enclosing test passed twice (**7/7 each**). Untouched and repeated creation correctly end in empty Sessions; their absent response-marker diagnostics are not failures. Nonempty targets use actual rendered fixture content. Existing mutation tests cover POST success/failure ownership; the new source guard covers nonblocking hydration and stale-error suppression.[^local]

| Public-path suite | Scenarios at each width | Result |
|---|---|---|
| DOM action suite | Ordinary creation, held untouched creation, sidebar before/after deferred refresh, other Room, real Browser Back, second creation while first hydration is held | 14/14 |
| Trusted-pointer supplement | Sidebar switch, other Room, real Browser Back, repeated creation | 8/8 |

Real bootstrap responses were withheld in the browser, not replaced with fabricated DTOs. New Session had to become enabled while hydration remained held. Nonempty final targets required an actual assistant marker intersecting the scroller and passing an `elementFromPoint` occlusion check; URL, mounted text, or composer alone did not establish visible-content readiness. Empty Sessions instead require the correct persisted identity and route. Browser Back uses the browser history API, not synthetic route assignment.[^dom][^pointer]

After releasing held hydration, all **1,484 DOM-suite and 849 pointer-suite samples** retained the expected Terminal Session identity: **2,333 samples, zero wrong-Session samples**. Final routes also agreed. Pointer capture confirms trusted clicks on New Session and Session/Room navigation controls. The eight pointer scenarios recorded **zero Long Tasks**. RAF observations are sampled evidence, not a guarantee about every painted frame.[^dom][^pointer]

# Responsiveness measurements

In the fourteen DOM-action cases, the first frame with the new persisted route and re-enabled New Session control arrived **51.6–80.4 ms** after probe-triggered creation. First creation POST responses took **21.1–34.3 ms**, while first hydration responses took **271.0–366.7 ms**. The control therefore no longer waits for hydration. These are intra-run phase measurements, not a paired remote before/after benchmark or population percentile.[^dom]

The first new Terminal root was observed at **172.7–375.1 ms**. That is a mounted-root diagnostic, not proof of visible response content. The nonempty navigation checks separately require viewport-visible real markers. Navigation intent timers include browser automation and sidebar preparation; they are not pure click-to-content latency benchmarks. Artificial response gates amplify ownership races and are not server-latency measurements.

# Real tool, Queue, and reload

A real Spark turn requested `sleep 20; echo PB_CREATION_TOOL_COMPLETE`. Explicit Queue accepted its successor at `2026-09-06T01:39:24.122Z`. The predecessor finished at `01:39:44.767Z`; the queued turn started at `01:39:44.776Z`: **9 ms drain**. The pointer suite exercised creation and navigation around this active tool/queued-turn interval and its settlement. The requested tool wait is not Queue dispatch latency.[^events]

Actual assistant, tool-turn, and Queue completion markers survived full reload. Final native trace reconstruction reported **13 nodes, zero issues**, including the later status-contention diagnostic turn. DevTools reported no console warnings/errors. Visual evidence: [mobile Browser Back](/reports/artifacts/session-creation-ownership-2026-09-06/mobile-back.png) and [desktop reload](/reports/artifacts/session-creation-ownership-2026-09-06/desktop-reload.png).

# Separate status-scaling finding

Follow-up issue #933 records an unchanged-backend bottleneck found during cleanup. With 29 live runtime Sessions, three read-only `/gateway/status` measurements took **3663.9 / 3214.8 / 3571.4 ms**, returning HTTP 200 and 21,100 bytes. The normal CLI's three-second deadline timed out. A bounded burst of three concurrent status requests completed at **3390.2 / 6736.2 / 9899.6 ms**; a health request issued 100 ms later waited **10079.6 ms**.

Do not generalize this to all traffic: an authenticated navigation read completed in **160.8 ms** during that burst. During a second burst, real Spark message admission took **72.6 ms**, with accepted-to-started **30 ms**; its short turn completed after **9.2 seconds**, without proof of provider-versus-local causation. The reported ten-second Queue drain remains unreproduced. Per-runtime `snapshotSignalSession` expansion in gateway status is a source lead, not yet a CPU-profile conclusion.

After idle eviction reduced live runtimes to 14, a diagnostic status request took **1763.9 ms**; the normal CLI subsequently succeeded and reported idle. No restart guard was weakened or bypassed. Timing, admission, native events, timeout, and final status artifacts are published alongside the creation measurements for the next investigation.

# Reproduction and validation limits

- Docker: `npm run build` and `npm run typecheck` passed at the accepted code. **21 focused tests passed; one opt-in test skipped**, then separately executed headful with `PIBO_TEST_CDP_URL=http://127.0.0.1:<managed-cdp-port> node --test test/chat-ui-session-create-navigation-race.test.mjs`. Full repository suite and integrated release gates were not run.
- The final build monitor was PSI-stopped; the independent Docker pipeline continued and its explicit exit file and completed build/typecheck logs were separately verified as zero. The monitor itself did not succeed.
- The first remote probe had an incorrect native-fetch receiver (`Illegal invocation`), so no creation POST reached the server. After correcting the wrapper to use `apply(window, args)`, both accepted suites passed. That instrumentation failure is excluded from acceptance counts.
- Initial setup waited for the wrong assistant-row selector; it resumed without resending accepted prompts after correcting `message.assistant`. No successful real prompt was duplicated.
- Hydration rejection behavior has a committed source guard; no injected HTTP-error acceptance case is claimed. Pre-POST Browser Back, Room mutation ownership, large-history scroll regressions, and full accessibility/platform coverage are outside this patch's evidence.
- Published probes retain run-specific paths and IDs. Acquire a fresh isolated authenticated target and substitute its own identities before reuse. Logs have trailing whitespace normalized; complete structured frame values are preserved. `summary.json` labels control readiness separately from content readiness.
- Documentation core, migration, indexes, log, and 84 focused documentation tests passed in the worktree (Docker Git-metadata limitation). `npm run docs:validate` / strict retains only the known three missing screenshots in the September 5 Session-native workflow report; no historical artifact was fabricated.

[^dom]: Source `dom`; complete frames, request phases, persisted identities, and final visible marker checks.
[^pointer]: Source `pointer`; trusted input events, Long Tasks, frame samples, and actual assistant content.
[^events]: Source `events`; native acceptance, tool, predecessor-finish, and successor-start timestamps.
[^local]: Source `local`; final headful regression, with parent/partial failures and full build/typecheck/focused logs alongside it.
[^code]: Source `code`; immediate selection invalidation and post-POST background hydration in `App.tsx`.
