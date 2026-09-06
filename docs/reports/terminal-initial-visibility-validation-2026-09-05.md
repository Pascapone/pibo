---
type: "Validation Report"
title: "Terminal initial visibility latency validation — September 5, 2026"
description: "Records exact-candidate headful evidence for removing redundant Terminal initialization settlement and a separate viewport-resize defect."
tags: ["terminal", "performance", "session-switching"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-05T23:01:41Z"
sources:
  - id: "measurements"
    resource: "/reports/artifacts/terminal-initial-visibility-2026-09-05/measurements.json"
    title: "Recorded headful frames, runtime identity, and benchmark results"
  - id: "events"
    resource: "/reports/artifacts/terminal-initial-visibility-2026-09-05/spark-events-and-check.txt"
    title: "Actual Spark streaming, tool, Queue, and trace evidence"
  - id: "code"
    resource: "scope:Commit 48f3f2ac39ba11c65112208034790fb63fb32fe2"
    title: "Exact locally validated visibility implementation"
---

# Result and scope

[Issue #927](https://github.com/Pascapone/pibo/issues/927) is addressed by removing the second initial-position owner from `CompactTerminalSessionView`: `useStickyVirtuoso` retains bottom and reading-position control, without Virtuoso's additional initial-index settlement interval. There is no vendor patch, forced CSS visibility, arbitrary replacement timer, or change to native transcripts.[^code]

The change is accepted for **initial Terminal visibility**, not as completion of the wider Session/Room performance goal. A separate late mobile viewport shrink was reproduced on the unchanged parent and filed as [#928](https://github.com/Pascapone/pibo/issues/928). No release, merge, controller deployment, or universal latency guarantee is implied.

# Exact targets and method

- Candidate: `48f3f2ac39ba11c65112208034790fb63fb32fe2`, package `1.7.2`, archive SHA-256 `39301aa5b229993e3a7c1f9d6bad9eaad38cf0641f9e285aca2eb880809cc551`.
- Matched source parent: `b3bda5ef0a61ff93babeae6f3e91b59c02e41a28`, archive SHA-256 `366886c08a15081ee4ec1c82861714c1808489ba3f5037e6b0df64fce178c22a`. Its frontend was freshly rebuilt in the same Docker worker from the clean detached parent; unchanged backend build output was reused. The worker was returned to its candidate branch afterward.
- Candidate Pibo2 pool lease `lease_1b7887068b252227b3`, slot-01; parent lease `lease_073e49c1a3278d6181`, slot-02. Both used full allowed seed and the public HTTPS/Machine Auth path. The pool's runtime fingerprint is distinct from the original npm archive checksum.
- Existing supervised **headful** Chrome, Browser Use, Chrome DevTools/CDP; desktop 1431×908 and mobile 390×844. No duplicate page load was intentionally added.
- Largest historical Session `ps_069cced9-7902-4b10-8bd6-279d7b98ece1`, Room `room_209cf2ff-6b46-4705-a216-a6d2138604bd`, 16,005 events. Full pool seed omits Pi transcripts, so the matching 21,023,113-byte file was copied into each isolated slot before opening it. Initial SHA-256: `c486c0f90709f4bc3061f7386cbf02e49c88c690adf490aa99b664a130c12d2c`.
- Real new Sessions explicitly used `rt-pi-spark`; status confirmed `openai-codex/gpt-5.3-codex-spark`. Historical Sessions were inspected only; no prompt was sent to their saved models.
- RAF samples distinguish selected Session, mounted rows, CSS visibility, viewport intersection, bottom gap and row identity. Sidebar actions were exercised repeatedly; mobile opens the drawer first. Timings begin at Session selection, not drawer opening. Correct mounted text alone is not readiness.

# Before and after

Three warm returns to the large history in each condition; these are small observational samples, not population percentiles.[^measurements]

| Headful condition | Click to first visible Terminal content | Extra mounted-but-hidden interval |
|---|---|---|
| Parent, desktop | 314.5 / 314.8 / 333.2 ms | 155.2 / 172.3 / 192.0 ms |
| Candidate, desktop | 177.3 / 178.0 / 115.3 ms | 0 / 0 / 0 ms |
| Parent, mobile | 307.6 / 353.7 / 316.7 ms | 146.2 / 186.3 / 194.4 ms |
| Candidate, mobile | 161.3 / 158.8 / 160.1 ms | 0 / 0 / 0 ms |

Every first visible frame was correctly bottom-aligned. Desktop runs had no later off-bottom frames in the sampled switching windows. The separate mobile late drift below is **not** counted as a pass for steady-state scrolling. An additional older canonical baseline measured 299.1–335.7 ms; the matched parent comparison above is more relevant.

Candidate Session-creation request examples were 84.4–152.2 ms, versus one warm canonical 20.1 ms sample. Different cold state and hosts prevent an improvement claim; creation needs a dedicated comparable investigation. SSE connection durations are not request-processing latency.

# Scroll, streaming, and persistence checks

- Docker headful regression: 12/300 completed fixture messages at both viewports; five tests passed. Correct first-visible tail and no visible frame more than 24 px off bottom. The old initial-index behavior failed with 148.4/176.1 ms hidden intervals. Candidate short-history visibility was 56.5–68.1 ms.
- Genuine wheel detachment, switch away/back, then full reload of the large Pibo2 history retained the saved row. First visible return was 187.3 ms; full reload first visible content 1085.2 ms. All 235 visible reload samples contained the saved anchor with **zero pixel offset drift**.
- Local durable `/api/chat/action` status cards also retained their anchor across reload, 269 samples with zero offset drift. Transient backend prelude fixtures are not reload-persistence evidence.
- Actual Spark Session `ps_7ad30483-e38b-4228-beb2-f8881079e867` in Room `room_02543d3d-90d3-4ddb-b0bf-227f590c25bf`: 100-line reply with bold text; native 16-second streaming benchmark observed 22 text deltas / 3630 bytes, 26 overlay updates, 30 live computations totaling 5.7 ms, 20 Markdown renders totaling 77.8 ms, **zero Long Tasks**, no reported warnings or regressions. Operator delay is not TTFT.
- A second actual Spark turn executed `sleep 20; echo PB_VIS_TOOL_COMPLETE`; a message was explicitly submitted through **Queue while processing**. During that wait, switching back to visible correct content took 73.2–87.8 ms with zero extra hidden interval or off-bottom frames.
- Queue accepted at `22:56:06.322Z`; predecessor finished `22:56:26.494Z`; next turn started `22:56:26.505Z`: **11 ms drain gap**. Time spent waiting for the requested tool is not queue-drain lag. Replies and the streaming marker survived full reload; native trace checks passed.[^events]

# Separate confirmed defect and evidence limits

On **both parent and candidate**, mobile header hydration later moved the scroller top from 240 to 270.5 px and reduced clientHeight 547→517 px. scrollHeight stayed 9850 px and scrollTop 9303 px, leaving a 30 px bottom gap. This occurs after correct initial positioning and is tracked in #928. Source investigation points to observing the item list but not an externally resized viewport in `useStickyVirtuoso`; this report does not claim that follow-up is fixed.

Automation/setup caveats:

- One streaming submit returned CDP `Promise was collected` even though the whole prompt had already been accepted. UI and native accepted-event inspection confirmed exactly one full message, so it was **not retried**. The benchmark recorded the actual turn.
- An early local persistence setup incorrectly posted literal `/status` through the raw message API, producing unauthorized provider errors. Those completed local error turns are excluded; the replacement fixture correctly used `/api/chat/action`. No such failed setup ran on Pibo2.
- The yielded local validation monitor was stopped by host PSI policy. Its bounded Docker process continued: the chained exit file was `0`, with successful build/typechecks and 85 passed focused tests, one opt-in test skipped. The monitor itself did not succeed.
- No full repository suite or long-duration provider stress run was performed. Current quota/cold-runtime improvements in separate PRs #924/#926 were not included in this candidate.

# Commands and retained evidence

Local Docker: `npm run build`; `NODE_OPTIONS=--max-old-space-size=1536 npm run typecheck`; focused Terminal/sticky/optimistic/Session-switch tests (85 passed, 1 opt-in skipped); separately `PIBO_TEST_CDP_URL=<worker-cdp> node --test test/chat-ui-terminal-initial-visibility.test.mjs` (5 passed). The browser regression requires worker-local authenticated headful CDP and `PIBO_COMPUTE_WORKER=1`.

Documentation: 84 focused tests, core/migration validation and generated-index checks passed. `npm run docs:validate` retains exactly three pre-existing missing screenshot links in `session-native-workflow-transition-validation-2026-09-05.md`; no new strict-validation errors.

Pibo2: exact checksum-verified runtime installation, pool-native acquire/release; `pibo debug web scenario streaming-benchmark --duration 16000 --assert --json --artifact --cdp-url <headful-cdp>`; native debug events and `debug trace <session> --check`; Browser Use navigation/screenshots paired with CDP frame/geometry/network inspection.

- [Measurements and release records](/reports/artifacts/terminal-initial-visibility-2026-09-05/measurements.json)
- [Switch/visibility probe](/reports/artifacts/terminal-initial-visibility-2026-09-05/switch-probe.mjs)
- [Spark events and trace checks](/reports/artifacts/terminal-initial-visibility-2026-09-05/spark-events-and-check.txt)
- [Desktop reading position](/reports/artifacts/terminal-initial-visibility-2026-09-05/reading-desktop.png)
- [Mobile historical Terminal](/reports/artifacts/terminal-initial-visibility-2026-09-05/mobile-history.png)
- [Actual Spark result after reload](/reports/artifacts/terminal-initial-visibility-2026-09-05/spark-reload.png)

Both remote leases were released after recording evidence; the browser returned to the canonical historical Session. The controller gateway was not changed. Current behavior is owned by the [Terminal specification](/specs/web/trace-terminal-scrolling-and-workflow-projection.md).

[^measurements]: Headful frame sequences, exact target identities, accepted-event observations, and release records in the linked artifact.
[^events]: Actual persisted Pibo events and native trace checks for the named Spark Session.
[^code]: Committed visibility change plus local opt-in regression at the named source revision.
