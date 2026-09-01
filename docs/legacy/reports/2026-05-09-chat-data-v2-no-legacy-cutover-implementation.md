---
type: "Historical Record"
title: "Chat Data V2 No-Legacy Cutover Implementation"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/reports/2026-05-09-chat-data-v2-no-legacy-cutover-implementation.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "f4a7495c83651c58ce62e3a383b146562278e326"
  source_bytes: 2338
  source_sha256: "05ef207f7ca8487c9d5f90a87741c6100b88f06343ca538abc68b78d0edcc041"
  source_body_sha256: "05ef207f7ca8487c9d5f90a87741c6100b88f06343ca538abc68b78d0edcc041"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Data V2 No-Legacy Cutover Implementation

Date: 2026-05-09

## Implemented

This pass completes the practical V2 runtime cutover path behind:

```text
PIBO_CHAT_DATA_MODE=v2
```

New V2 adapters:

```text
src/data/chat-v2-adapters.ts
```

Adapters added:

- `ChatV2ReadModel`
- `ChatV2EventLog`
- `ChatV2RoomStore`

When Chat Web runs in `v2` mode, it now uses `pibo.sqlite` for the Chat Web read/event/room surfaces instead of opening the legacy `web-chat.sqlite` read model, event log, and room store.

## Covered Runtime Surfaces

V2 mode now covers:

- room create/update/list/tree/access through V2 `rooms` and `room_members`
- session indexing/navigation through V2 `sessions` and `session_navigation`
- durable chat event listing through V2 `event_log`
- trace event pages through V2 `event_log`
- trace summary sequence/version inputs through V2 `event_log`
- unread/read cursors through V2 `principal_session_stats` / `principal_room_stats`
- user message writes through V2 event log plus `ChatDataIngestService`
- output event writes through `ChatDataIngestService` to V2 messages/observations/event log
- delete/archive support through V2 tables where Chat Web calls the old surfaces

## Test Added

Added regression coverage in:

```text
test/web-channel.test.mjs
```

New test:

```text
chat web app v2 mode runs without creating the legacy web-chat store
```

It starts Chat Web with `dataMode: "v2"`, creates a session, sends a message, loads bootstrap, verifies V2 `event_log` rows exist, and verifies the legacy `chat.sqlite`/`web-chat` test store was not created.

## Validation

Local:

```text
npm run typecheck ✅
npm run build ✅
node --test test/web-channel.test.mjs ✅
npm test ✅
```

Full test result:

```text
348 passing
0 failing
```

Docker worker:

```text
npm run typecheck ✅
npm run build ✅
```

## Notes

- `pibo-sessions.sqlite` remains the product session store for now. This matches the cutover plan's non-goal/compatibility note: normal Chat Web no longer needs `web-chat.sqlite`, but the Pibo Session Store is not unified in this pass.
- Pi JSONL remains compatible and may still contribute transcript metadata/history where Pi Coding Agent owns it.
- Legacy importer remains available for backfilling existing live data into V2 before enabling `PIBO_CHAT_DATA_MODE=v2` on a gateway.
