---
type: "Evidence Report"
title: "Incident 2026-05-16: Chat Web session stuck in partial tool call"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/incident-2026-05-16-stuck-toolcall-stream.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "543a0bd2710a47c45cd899064f3399f26f048ae8"
  source_bytes: 5348
  source_sha256: "5f17414fe89414d6692d6be76b1dff99208da176074ba8c01e2b6c699f46efb8"
  source_body_sha256: "5f17414fe89414d6692d6be76b1dff99208da176074ba8c01e2b6c699f46efb8"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:incident-2026-05-16-stuck-toolcall-stream"
  published_at: "2026-09-01T07:57:34Z"
---
# Incident 2026-05-16: Chat Web session stuck in partial tool call

## Summary

Session `ps_d63e27d2-3ceb-46a8-9c86-4340f8426783` stopped processing new user messages on 2026-05-16. The gateway process was healthy, but this session stayed `processing=true` and `streaming=true` with queued messages behind it.

The active model was `openai-codex / gpt-5.5` through `openai-codex-responses`.

## Timeline (UTC)

- `04:28:28` user message accepted and processing started (`turn/eventId d3038cbc-70ff-4799-8bd1-f37483817ca6`).
- `04:29:05` model produced two complete bash tool calls; both executed.
- `04:29:49` second tool execution finished.
- `04:29:50` reasoning started again.
- `04:30:00` reasoning finished.
- `04:30:01` provider emitted a new `toolcall_start` for bash (`argsComplete=false`, no complete args in Pibo event log).
- `04:31:21` user message “Mach das.” accepted and queued.
- `04:32:12` user message “Ok” accepted and queued.
- `04:36:21` diagnostic status showed `queuedMessages=2`, `processing=true`, `streaming=true`.
- `04:37:27` abort was issued; session emitted `session_error: This operation was aborted`, then completed the stuck message and drained the queued messages.

## What actually happened

The stuck turn reached the provider-stream phase. Pibo received a `toolcall_start` for a bash tool call, but never saw the corresponding tool-call completion / response completion needed for the agent loop to execute the tool.

The Pi session file later showed the aborted assistant message contained a partial bash tool call with only a partial `command` field. This means the provider had begun emitting tool-call arguments, but the stream did not finish the function call. The partial command is intentionally not reproduced here.

## Evidence

Pibo event log around the hang:

- `326978` — `tool_call`, `argsComplete=false`, `toolName=bash`.
- No `tool_execution_started` for that tool call before abort.
- `327234` — `session_error`, error `This operation was aborted`.
- `327236` — stuck message marked finished after abort.
- `327237+` — queued messages started processing normally.

Gateway status during the hang:

- `queuedMessages=2`
- `processing=true`
- `streaming=true`
- `disposed=false`
- model `openai-codex / gpt-5.5`

## Most likely root cause

Upstream OpenAI Codex Responses SSE stream stalled or stopped making forward progress mid function-call argument generation. Pibo had no provider-stream inactivity timeout, so `reader.read()` could wait indefinitely. The session queue is single-threaded, so subsequent messages stayed queued.

## Contributing factors

1. `@mariozechner/pi-ai` OpenAI Codex Responses provider does not enforce `timeoutMs` on the SSE body read.
2. Pibo does not persist raw provider SSE events or provider progress heartbeats.
3. Pibo normalizes `toolcall_start` and `toolcall_end`, but not `toolcall_delta`, so the live event log cannot show partial argument progress.
4. The OpenAI Responses stream parser silently ignores JSON parse errors and unknown event types.
5. `processResponsesStream()` tracks a single `currentItem/currentBlock`; with `parallel_tool_calls=true`, interleaved tool-call items could be mishandled if the provider interleaves deltas.
6. There is no watchdog that auto-aborts a turn when no normalized event has been emitted for N minutes while `isStreaming=true`.

## Prevention recommendations

### Runtime guardrails

- Add provider-stream inactivity watchdog: if no provider event / normalized event arrives for a configurable duration while streaming, abort the provider request and emit a typed timeout error.
- Make Codex Responses provider honor `retry.provider.timeoutMs` for the whole request or at least for stream inactivity.
- On timeout, clear `processing` and allow queued messages to continue.

### Observability

- Persist provider request lifecycle events: request started, response headers, first byte, last raw event time, completion, abort/timeout.
- Record upstream `response.id`, request id/session id, model, transport, service tier, and sanitized response status.
- Count and timestamp raw SSE events by type. Do not store secrets or full payloads by default.
- Log unknown SSE event types and JSON parse failures with redacted snippets and counters.
- Persist `toolcall_delta` metadata or at least `argsLength`, `argsKeys`, and `lastDeltaAt`.
- Expose `activeTurn`: event id, phase (`reasoning`, `tool_args`, `provider_wait`, `tool_exec`), active tool id, last event age, queue length.

### Correctness hardening

- Track OpenAI Responses items by `item.id` / `item_id` instead of one global `currentItem/currentBlock`, especially with `parallel_tool_calls=true`.
- Consider disabling `parallel_tool_calls` for providers/versions where stream ordering is uncertain.
- Add tests for: partial tool-call stream timeout; aborted partial tool-call cleanup; interleaved parallel tool-call deltas; unknown/invalid SSE chunks.

## Missing data that would have made diagnosis definitive

- Raw SSE event type timeline from the provider.
- Last raw byte timestamp vs last parsed event timestamp.
- Upstream response id / request id for the stalled request.
- Whether the TCP stream was only heartbeating, sending unknown events, or entirely idle.
- Provider response headers and server timing for the specific request.
