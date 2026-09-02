---
type: "Historical Record"
title: "Chat Data V2 No-Legacy Cutover Progress"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/reports/2026-05-09-chat-data-v2-no-legacy-cutover-progress.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "3d5060cd16644095195cf9bc2c31cdb4810f2893"
  source_bytes: 2783
  source_sha256: "ee034498a7fa0eb1e61847d51c1f8e735a1f636218c7b8a0c87e1d48eeea15f3"
  source_body_sha256: "ee034498a7fa0eb1e61847d51c1f8e735a1f636218c7b8a0c87e1d48eeea15f3"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Data V2 No-Legacy Cutover Progress

Date: 2026-05-09

## Scope Implemented in This Pass

This pass starts the no-legacy cutover plan. It does **not** complete the full Chat Web V2-only runtime cutover yet.

Implemented:

1. `PIBO_CHAT_DATA_MODE=v2` plumbing in Chat Web options.
2. Idempotent legacy Chat Web importer CLI.
3. Tests for importer idempotency.
4. Full local test-suite validation.
5. Docker worker typecheck/build validation.

## New CLI

```bash
npm run --silent dev -- data import legacy-chat --json
```

Options:

```text
--root DIR          Use DIR as the Pibo home root
--from DIR          Legacy source root
--to FILE           Target pibo.sqlite file
--payload-root DIR  V2 payload directory
--json              Machine-readable report
```

The importer reads:

```text
web-chat.sqlite
pibo-sessions.sqlite
```

and writes to:

```text
pibo.sqlite
```

## Imported Data

The importer currently migrates:

- rooms -> `rooms`
- room members -> `room_members`
- Pibo sessions -> `sessions`
- legacy `chat_events` -> `event_log`
- accepted user messages -> `chat_messages`
- legacy `web_chat_events` -> `event_log`
- assistant messages -> `chat_messages`
- trace-like durable events -> `observations`
- session navigation projection -> `session_navigation`
- source-to-target records -> `migration_import_map`

It is designed to be rerunnable. A second import skips already-imported rows instead of duplicating them.

## Data Mode Plumbing

Chat Web now accepts:

```ts
dataMode?: "legacy" | "v2"
```

and reads the environment variable:

```text
PIBO_CHAT_DATA_MODE=v2
```

For now, `v2` mode only ensures the V2 store is opened and V2 write plumbing is active. It does **not** yet switch all Chat Web read paths away from the legacy read model and room/event stores.

## Validation

Local validation:

```text
npm run typecheck ✅
npm run build ✅
node --test test/data-cli.test.mjs ✅
npm test ✅
```

Full result:

```text
347 passing
0 failing
```

Docker worker validation:

```text
npm run typecheck ✅
npm run build ✅
```

## Remaining Work

The full no-legacy cutover is not done yet. Remaining major pieces:

1. Add V2-backed Chat Web read adapters/endpoints.
2. Add V2-backed room store for normal Chat Web room operations.
3. Add V2-backed durable event/read-cursor store.
4. Switch `bootstrap`, `navigation`, `sessions`, `trace`, `events`, and room APIs to V2 in `PIBO_CHAT_DATA_MODE=v2`.
5. Verify Chat Web works with `web-chat.sqlite` moved aside.
6. Remove or quarantine legacy Chat Web runtime paths after V2 mode is stable.

## Important Caution

Do not deploy with the assumption that `PIBO_CHAT_DATA_MODE=v2` is fully V2-only yet. It is currently the cutover flag and store activation plumbing, not the completed read-path cutover.
