# Chat Web live render-order diagnosis — 2026-08-09

## Verdict

The new render-order instrumentation reproduced the reported Compact Terminal instability through the authenticated public Pibo2 Chat UI on the exact Production `1.11.2` code plus instrumentation only.

During one real OpenAI-backed turn, the live client:

- replaced the identity of the first reasoning node three times;
- reordered existing Terminal rows twice while tools and yielded runs reconciled;
- reached an idle live state with 22 visible rows, while an immediate reload rendered the canonical 15-row transcript;
- removed seven live-only rows on reload and changed the relative order of surviving tool rows.

The evidence rules out a screenshot-only or React-only explanation. The divergence is already present in the client trace objects before DOM rendering.

No behavioral fix was present in the diagnostic candidate.

## Environment

```text
public UI: https://pibo2.neuralnexus.me/apps/chat
candidate: stream-render-order-prod-instrumented
candidate commit: ac99756ea49a3acced66ee41e760fbceb9760c2e
production base: b0e63e473e623f6cbe3476c6b4e88c815ebc34e8 (release-1-11-2)
tooling source commit: 419aba0b77561c8c6fe585a7764276bb2e8dee18
reproduction session: ps_dfac9936-c347-4fb2-918b-53c5ae562ebb
reproduction room: room_cddb8f73-eb59-4532-bf09-4a409fd6bd2d
turn event id: web-msl7zln5-7dffe27b-ac27-48a7-ab23-373c6cb35b65
turn events: stream 977957 through 978019
turn completion: 2026-08-09T03:06:09.601Z
```

The scenario started three tracked yielded runs, waited for them sequentially, read each result, executed two additional read-only shell commands, and returned ten concise observations. The event log contains 63 events: seven reasoning starts, seven reasoning finishes, ten tool starts, ten tool finishes, twenty tool-call events, four service/user queued-message events, one assistant message, and one final message boundary.

## Safety and rollback

A verified pre-activation backup was retained:

```text
/root/.pibo/server-backups/31.70.66.85-pibo-20260809T025602Z.tar.zst
```

Diagnostic activation rollback:

```text
/root/.pibo-deploy-rollbacks/20260809T030329Z-stream-render-order-prod-instrumented
```

After evidence capture, Production was restored to:

```text
candidate: release-1-11-2
commit: b0e63e473e623f6cbe3476c6b4e88c815ebc34e8
restoration rollback: /root/.pibo-deploy-rollbacks/20260809T031134Z-release-1-11-2
```

The post-restore gateway was idle, reachable, and had zero active yielded runs.

## Reproduction

1. Activate the exact Production code with only commit `419aba0b`'s render-order instrumentation cherry-picked.
2. Open the authenticated public Chat UI in Compact Terminal view.
3. Run a turn containing repeated reasoning phases, tool calls, and tracked yielded runs.
4. Capture `pibo debug web streaming-benchmark` continuously through final idle state.
5. Capture the final DOM and client-state snapshot before reload.
6. Reload the same session and capture the DOM again.
7. Rebuild the canonical trace with `pibo debug trace --check`.

Expected:

- existing conceptual rows keep one identity and relative order;
- final idle live state equals immediate reload state;
- transient event projections and run notifications do not survive their canonical transcript handoff.

Observed:

- identity replacement and reorder transitions occurred before idle;
- final live state differed from reload in both membership and order.

## Correlated transition evidence

### Reasoning identity replacement

The first reasoning concept used these identities in sequence:

```text
event:thinking:<turn>:thinking:0
event:thinking:<turn>
event:thinking:<turn>:thinking:0
event:thinking:<turn>
```

The first replacement occurred at `2026-08-09T03:05:29.602Z`. The client base trace changed from the indexed event node to the unindexed event node even though the content length remained 42 characters and the event ID remained unchanged.

The raw stored events retain `thinkingIndex: 0`, but `outputPayloadFromV2Row()` reconstructs persisted `thinking_started` and `thinking_finished` events without reading the stored `thinkingIndex` or `contentIndex`. It likewise reconstructs `assistant_message` without `assistantIndex` or `contentIndex`.

Consequently:

- live/SSE projection derives `event:thinking:<turn>:thinking:0`;
- refreshed persisted projection derives `event:thinking:<turn>`;
- live assistant projection derives `event:assistant:<turn>:assistant:0`, while persisted reconstruction can derive the event-level identity.

This is a confirmed data-mapping identity defect, not a missing index in the emitted model events.

Relevant code:

```text
src/apps/chat/data/chat-data-mappers.ts
src/shared/trace-event-projection.ts
src/apps/chat/output-compactor.ts
```

### Terminal reorder transitions

The timeline recorded two row reorders. One captured transition moved the first bash tool row from index 5 to index 2 while the first yielded-run row moved from index 7 to index 4. A later transition moved that tool row back from index 2 to index 5 and the yielded-run row from index 4 to index 7.

These transitions correlated with refreshed base-trace and overlay changes; they were not visual-only movement. DOM order and visual order matched the current Terminal row objects at the time of each transition.

### Final live state versus reload

Final live DOM: 22 Terminal rows.

Immediate reload DOM: 15 Terminal rows.

Rows present live but absent after reload:

```text
terminal:reasoning:<turn>
terminal:run:run_76eb2d99-82f5-406c-953c-623218dec322
terminal:run:run_525ed964-735d-4c83-a4cc-0ca01943af0b
terminal:run:run_bca8c755-dd33-45bf-bd03-088a9e0fe5c4
terminal:reasoning:<turn>:thinking:5
terminal:reasoning:<turn>:thinking:6
terminal:assistant:<turn>:assistant:0
```

At the last idle client trace snapshot:

```text
base nodes: 19
overlay events: 101
current nodes: 24
visible Terminal rows: 22
```

The canonical post-reload trace contained 15 transcript nodes and `pibo debug trace --check` reported zero structural issues. The canonical final assistant message at stream `978018` was intact.

## Reconciliation root cause

Two independent mechanisms combine into the visible defect.

### 1. Persisted event reconstruction drops content-part identity

`attributesForOutputEvent()` stores assistant/reasoning indices, but `outputPayloadFromV2Row()` does not restore them for:

- `assistant_message`;
- `thinking_started`;
- `thinking_finished`.

The same conceptual event therefore receives different IDs and stable keys before and after refresh.

### 2. Refreshed tail and live overlay retain obsolete event projections

`mergeRefreshedTracePage()` calls `mergeTraceNodes(current.nodes, refreshed.nodes)`. `mergeTraceNodes()` indexes strictly by `node.id`, so refreshed transcript nodes do not supersede conceptually equivalent event-log nodes whose IDs differ.

`reconcileLiveTraceOverlayCache()` then trims only events that the refreshed base can confirm by the existing event/node identity rules. Transcript assistant/reasoning nodes do not carry the event IDs needed by those rules, and service run-notification events have no canonical transcript row. The idle overlay therefore retained 101 events and re-projected stale reasoning, assistant, and yielded-run rows until reload discarded the in-memory state.

Relevant code:

```text
src/shared/trace-page-merge.ts
src/apps/chat-ui/src/tracing/live-overlay.ts
src/apps/chat-ui/src/tracing/current-trace-view.ts
src/apps/chat-ui/src/tracing/use-session-trace-page.ts
src/shared/trace-event-projection.ts
src/session-ui/terminalRows.ts
```

## Existing issue comparison

The reproduced behavior overlaps three existing issue contracts:

- `#144` — reasoning rows disappearing/reappearing or moving on finalization;
- `#328` — source-independent conceptual Terminal row identities across projections;
- `#331` — monotonic rendered ordering across transcript and event-log sources.

The new evidence confirms the browser symptom and identifies two concrete reconciliation defects that remained present in Production `1.11.2`. It should be added to the existing issue records rather than filed as a duplicate. An authenticated issue-comment/reopen helper was not available on this host, so the complete update draft is preserved separately in `/tmp/pibo-render-order-existing-issue-update.md`.

## Durable artifacts

```text
43dbb318364bf79db8f4bf867de0a5c42bdf36b892bb3f2f19e3da23335a42bc  /root/.pibo/debug/web-render/2026-08-09T03-05-48-945Z/scenario-streaming-benchmark.json
6db450fafc85dfa55f13ca3956febacee3e9ac6b37d245c3952eae87728cdb3d  /root/.pibo/debug/web-render/2026-08-09T03-06-35-491Z/scenario-streaming-benchmark.json
19d6ba0c61ffbcbb78d15167531e7b2691f8889a8c5fe8bfde6227f2bc0d159f  /tmp/public-final-before-reload.json
32475fa029248c8376f18b717f05f1a1082d3eb612ebe79af72e2ce80efab8ff  /tmp/public-final-after-reload.json
2da5603bb19a22f68ce0c5fb9ac9fd64d591d49f900a27195fa8f7467171c4bf  /tmp/public-render-order-correlated-transitions.txt
5e0a9308f6036b578a6289083e487a5704675bb3fd5557e24e25cc850cf81235  /tmp/public-probe-trace-check.json
c3b856b612acd046e33b95eb9972a17cd95d3bcb7a371558c331554e25318f65  /tmp/public-probe-events.json
```

The `/tmp` artifacts are controller-local evidence; the two benchmark JSON files are retained under Pibo's durable debug artifact directory. This report preserves the non-sensitive findings needed for review and issue triage.

## Fix boundaries

The diagnosis supports two focused fixes:

1. restore persisted assistant/reasoning part indices in `chat-data-mappers.ts`, with mapper and projection-handoff tests;
2. make refreshed-tail/overlay reconciliation remove obsolete event-only projections once canonical transcript state is available, while preserving genuinely older paginated history.

The fixes should remain separate from the tooling PR and be validated as an exact integrated candidate containing both the tooling and each fix.
