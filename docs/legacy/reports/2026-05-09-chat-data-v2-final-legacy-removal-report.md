# Chat Data V2 Final Legacy Runtime Removal

Date: 2026-05-09

## Changed

Chat Web now uses Chat Data V2 by default and no longer has a runtime legacy mode.

Removed from Chat Web runtime options/code:

- `PIBO_CHAT_DATA_MODE`
- `PIBO_DATA_V2_WRITE`
- `dataMode`
- `dataV2Write`
- `readModelPath`
- `eventLogPath`
- `roomStorePath`

Chat Web now always creates a `PiboDataStore` and wires:

- `ChatV2ReadModel`
- `ChatV2EventLog`
- `ChatV2RoomStore`
- `ChatDataIngestService`

Normal Chat Web runtime no longer opens `web-chat.sqlite`.

## Runtime Fixes

- Output events now write directly through `ChatDataIngestService` when the V2 event-log compatibility adapter does not return a legacy stored event.
- V2 event rows are reconstructed into Chat Web trace/SSE payloads so trace pages and durable SSE replay work without legacy event payload rows.
- Navigation upserts preserve an existing `last_message_preview` when a later metadata-only session upsert has no preview.

## Data Migration

A backup was created before import:

```text
/root/.pibo/backups/chat-v2-final-cutover-20260509-103432
```

Legacy data was imported into:

```text
/root/.pibo/pibo.sqlite
```

Reports:

```text
reports/chat-data-inventory-before-final-v2-cutover-20260509.json
reports/chat-data-import-final-v2-cutover-20260509.json
reports/chat-data-import-final-v2-cutover-rerun-20260509.json
```

First import:

```text
rooms: 8
roomMembers: 8
sessions: 262
events: 175755
messages: 2497
observations: 87357
navigation: 262
```

Second import skipped already imported durable rows.

## Validation

Local:

```text
npm run typecheck ✅
npm run build ✅
npm test ✅
348 passing, 0 failing ✅
```

Focused Docker worker validation in `v2-final-removal`:

```text
npm run typecheck ✅
npm run build ✅
web-channel focused V2 tests ✅
```

## Remaining Legacy Surface

Legacy Chat Web SQLite code still exists as historical/import/debug code and for tests around the old store. It is no longer part of normal Chat Web runtime wiring.

`web-chat.sqlite` remains available as an import/backup source only.
