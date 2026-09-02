---
type: "Research"
title: "Chat Web live render-order diagnosis — 2026-08-09"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/chat-web-live-render-order-diagnosis-2026-08-09.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "818263d8f41baf3978b4f73817fd90fc470fc4ef"
  source_bytes: 8723
  source_sha256: "ddc1a34e36582812bac81010b6be28bc3e1bbad0c973cbd9e17cf93599e47e3e"
  source_body_sha256: "ddc1a34e36582812bac81010b6be28bc3e1bbad0c973cbd9e17cf93599e47e3e"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
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
public UI: operator-configured authenticated Chat Web deployment
candidate: stream-render-order-prod-instrumented
candidate commit: ac99756ea49a3acced66ee41e760fbceb9760c2e
production base: b0e63e473e623f6cbe3476c6b4e88c815ebc34e8 (release-1-11-2)
tooling source commit: 419aba0b77561c8c6fe585a7764276bb2e8dee18
reproduction identifiers: omitted
turn completion: 2026-08-09T03:06:09.601Z
```

The scenario started three tracked yielded runs, waited for them sequentially, read each result, executed two additional read-only shell commands, and returned ten concise observations. The event log contains 63 events: seven reasoning starts, seven reasoning finishes, ten tool starts, ten tool finishes, twenty tool-call events, four service/user queued-message events, one assistant message, and one final message boundary.

## Safety and rollback

A verified pre-activation backup and named diagnostic rollback were retained in operator-managed deployment storage.

After evidence capture, Production was restored to:

```text
candidate: release-1-11-2
commit: b0e63e473e623f6cbe3476c6b4e88c815ebc34e8
restoration rollback: verified; operator path omitted
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
terminal:run:<yielded-run-1>
terminal:run:<yielded-run-2>
terminal:run:<yielded-run-3>
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

The canonical post-reload trace contained 15 transcript nodes and `pibo debug trace --check` reported zero structural issues. The canonical final assistant message was intact.

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

The new evidence confirms the browser symptom and identifies two concrete reconciliation defects that remained present in Production `1.11.2`. It should be added to the existing issue records rather than filed as a duplicate. An authenticated issue-comment/reopen helper was not available on the operator host, so publication remains pending.

## Durable artifacts

Two benchmark captures plus before/after reload snapshots, correlated-transition output, trace-check output, and compact event metadata are retained in operator-managed debug storage. Host paths, session identifiers, event identifiers, and file hashes are intentionally omitted from this committed report.

## Fix boundaries

The diagnosis supports two focused fixes:

1. restore persisted assistant/reasoning part indices in `chat-data-mappers.ts`, with mapper and projection-handoff tests;
2. make refreshed-tail/overlay reconciliation remove obsolete event-only projections once canonical transcript state is available, while preserving genuinely older paginated history.

The fixes should remain separate from the tooling PR and be validated as an exact integrated candidate containing both the tooling and each fix.
