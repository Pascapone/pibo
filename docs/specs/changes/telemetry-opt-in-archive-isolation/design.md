# Design: Telemetry Opt-In Archive Isolation

**Status:** Draft
**Created:** 2026-07-04
**Related spec:** `spec.md`
**Related changes:** `../chat-web-trace-v2-fast-path/`, `../gateway-resource-protection-workers/`

## Design Summary

Move detailed telemetry from an always-on live database feature to explicit capture runs. A capture run owns its own active telemetry store. When stopped, it becomes an archive with a manifest. The live gateway never loads archive databases by default. Legacy live telemetry is made inert on upgrade and handled by offline/batch maintenance tools.

## Design Principles

1. **Gateway safety first.** Telemetry must never block gateway startup, health checks, Chat Web bootstrap, or normal session routing.
2. **Opt-in by default.** Detailed telemetry is collected only after explicit operator action.
3. **Scope and limits.** Every capture run has scope, duration, size, and detail limits.
4. **Archive isolation.** Archived telemetry is inert data, not part of the live system.
5. **Progressive inspection.** Operators inspect telemetry through summaries and bounded selectors, not full-table dumps.
6. **Crash tolerance.** Capture runs and archive finalization survive crashes with recoverable state.
7. **Privacy by design.** Verbose payload capture requires clear controls and deletion paths.

## Data Model

### Live Operational Store

The live store continues to contain data required by the running product:

```text
pibo.sqlite
pibo-events.sqlite
other existing operational stores
```

The live store must not receive detailed telemetry rows when telemetry is off.

### Telemetry Root

Recommended root:

```text
$PIBO_HOME/telemetry/
  active/
  archives/
  tmp/
  legacy/
```

### Active Run Layout

```text
$PIBO_HOME/telemetry/active/<run-id>/
  manifest.json
  telemetry.sqlite
  artifacts/
  lock
```

`manifest.json` is updated with bounded metadata. It must not be rewritten for every provider event; use periodic updates or finalization updates.

### Archive Layout

```text
$PIBO_HOME/telemetry/archives/<run-id>/
  manifest.json
  telemetry.sqlite
  artifacts/
```

Archives are immutable by convention. Maintenance tools may delete or compact them, but normal gateway code must not mutate them.

### Manifest Schema

Initial manifest fields:

```json
{
  "schemaVersion": 1,
  "runId": "trun_...",
  "piboVersion": "1.7.0",
  "status": "active|completed|stopped|failed|corrupt|migrated-legacy",
  "scope": {
    "kind": "session|room|global",
    "id": "ps_..."
  },
  "detailLevel": "summary|diagnostic|verbose",
  "limits": {
    "durationMs": 1800000,
    "maxBytes": 1073741824,
    "maxRawEvents": 1000000,
    "capturePayloads": false
  },
  "startedAt": "2026-07-04T00:00:00.000Z",
  "stoppedAt": null,
  "lastHeartbeatAt": "2026-07-04T00:05:00.000Z",
  "sizeBytes": 123456,
  "rowCounts": {
    "turns": 0,
    "providerRequests": 0,
    "providerEvents": 0,
    "toolCalls": 0
  },
  "notes": "optional operator note"
}
```

The list command should read manifests only. It should not open `telemetry.sqlite`.

## Capture Manager

Introduce a capture manager responsible for:

- loading active run manifests;
- validating active locks;
- starting and stopping runs;
- matching telemetry events to capture scope;
- selecting detail level;
- routing writes to active telemetry stores;
- enforcing duration and size limits;
- marking failed/corrupt runs;
- finalizing archives.

The manager exposes a small interface:

```ts
type TelemetryCaptureManager = {
  status(): TelemetryCaptureStatus;
  start(input: StartTelemetryCaptureInput): Promise<TelemetryCaptureRun>;
  stop(runId: string): Promise<TelemetryArchiveManifest>;
  record(event: RuntimeTelemetryEvent): void;
  listArchives(): Promise<TelemetryArchiveSummary[]>;
  recover(): Promise<void>;
};
```

`record` must be cheap when telemetry is disabled. It should return quickly without allocations or database access.

## Event Gating

All verbose telemetry writes must pass through a single gate:

```ts
if (!telemetryCapture.isEnabledFor(event.scope, event.detailKind)) return;
telemetryCapture.record(event);
```

Do not scatter raw database writes throughout runtime code.

## Detail Levels

### Summary

Records:

- turn start/end;
- provider request start/end;
- phase transitions;
- counters;
- timings;
- error categories;
- queue/wait summaries.

No raw provider events or payloads.

### Diagnostic

Records summary plus:

- provider event type sequence;
- parse status;
- tool-call lifecycle;
- bounded safe fields;
- correlation links.

No full payloads by default.

### Verbose

Records diagnostic plus:

- bounded raw provider event metadata;
- optional payload references;
- optional payload previews;
- strict size and count limits.

Payload capture should require separate confirmation.

## CLI Surface

Initial CLI commands:

```bash
pibo telemetry status
pibo telemetry start --scope session:<id> --duration 30m --level diagnostic [--capture-payloads]
pibo telemetry stop <run-id>
pibo telemetry archives list [--json]
pibo telemetry archive show <run-id> [--json]
pibo telemetry archive stats <run-id> [--json]
pibo telemetry archive export <run-id> --output <path>
pibo telemetry archive delete <run-id> [--confirm]
pibo telemetry legacy status [--json]
pibo telemetry legacy archive --mode batch [--limit ...]
pibo telemetry legacy prune --mode batch [--before ...]
```

`pibo debug telemetry ...` may delegate to these commands or expose read-oriented aliases.

## Web Surface

Chat Web Settings should show:

- telemetry status;
- active run details;
- start/stop controls;
- warning about sensitive debug data;
- archive list from manifests;
- archive delete/export/inspect actions.

Long archive actions must create jobs and return immediately. The UI must show job progress and allow cancellation.

## Gateway Startup Behavior

Startup sequence:

1. Initialize operational stores.
2. Initialize capture manager in disabled/recover mode.
3. Read active run manifests only.
4. Mark stale active runs as `failed` or `needs-recovery` if needed.
5. Do not open archive SQLite files.
6. Do not scan legacy telemetry tables.
7. Become healthy.

## Legacy Telemetry Handling

Existing installations may have large live telemetry tables. The upgrade must not migrate them in the gateway.

### Default Upgrade Behavior

- Stop writing new detailed telemetry to live tables.
- Mark live telemetry as legacy in metadata/config.
- Disable automatic retention against live telemetry tables.
- Expose legacy status command.

### Offline Archive Path

Provide a maintenance command that can create an archive from legacy telemetry:

```bash
pibo telemetry legacy archive --output $PIBO_HOME/telemetry/archives/legacy-... --batch-size 5000
```

This command must:

- run outside the gateway;
- use batches;
- report progress;
- be cancellable;
- avoid long exclusive locks;
- optionally leave original rows intact until explicitly pruned.

### Offline Prune Path

Provide a batch prune command:

```bash
pibo telemetry legacy prune --before 2026-07-01T00:00:00Z --batch-size 5000
```

It must not run automatically during gateway startup.

## Retention Model

Retention now applies to archives, not live gateway telemetry tables.

Archive retention policy options:

- manual only;
- delete archives older than N days;
- delete archives larger than total size budget;
- keep last N archives;
- require confirmation for verbose archives with payloads.

Automated retention, if enabled, must run in the resource-protected maintenance worker.

## Failure Handling

### Crash During Active Capture

On next startup:

- read active manifest;
- inspect lock/heartbeat metadata only;
- mark stale run `failed` or `needs-recovery`;
- allow operator to finalize or delete it;
- do not block startup.

### Disk Full

When active capture exceeds size or disk budget:

- stop capture;
- mark run `failed` with reason;
- keep operational gateway running;
- notify UI/status.

### Corrupt Archive

Archive list still shows manifest. Archive inspection reports corruption when explicitly opened.

## Performance Requirements

- Disabled telemetry gate should be near-zero overhead.
- Gateway startup should not scale with archive DB size.
- Listing archives should scale with manifest count, not archive row count.
- Archive inspection must be paginated and bounded.
- Legacy telemetry detection must avoid full-table scans.

## Testing Strategy

### Unit Tests

- settings defaults disable telemetry;
- capture scope matching;
- detail level filtering;
- manifest read/write validation;
- disabled telemetry gate does not call DB writer.

### Integration Tests

- fresh install runs session without detailed telemetry writes;
- active capture writes to isolated store;
- stopping capture creates archive;
- gateway starts with large fake archive file without opening it;
- legacy telemetry tables do not trigger retention on startup.

### UI/API Tests

- Settings shows telemetry off;
- start/stop capture flows;
- archive list reads manifests;
- archive delete starts a job, not a blocking request.

### Regression Tests

- Reproduce a large telemetry archive and assert `/health` responds during startup and normal navigation.
- Assert no `telemetry.sqlite` archive file descriptors are open after normal gateway startup.

## Rollout Plan

### Step 1: Disable New Live Detailed Telemetry

Add feature flag/default behavior so detailed telemetry writers no-op unless capture is active.

### Step 2: Add Capture Manager and Active Store

Create active run lifecycle and isolated storage.

### Step 3: Add Archive Finalization and Manifest Listing

Finalize runs into archives and list them safely.

### Step 4: Add CLI and Settings UI

Expose start/stop/list/show/delete controls.

### Step 5: Add Legacy Handling

Mark existing live telemetry as legacy and provide offline/batch archive/prune tools.

### Step 6: Remove Gateway Retention Path

Remove or disable request-path telemetry retention against live telemetry tables.

## Migration Notes

Existing large `pibo.sqlite` files may still include old telemetry tables. This spec does not require shrinking those files automatically. Shrinking SQLite requires prune plus checkpoint/vacuum, which may need planned downtime. The first priority is to stop new growth and stop gateway coupling.

## Open Design Questions

- Should active capture allow multiple simultaneous scoped runs?
- Should archive SQLite schema match old telemetry schema or use a new compact schema?
- Should archive manifests be indexed in a small live registry table, or should the system read manifest files directly?
- Should archive inspection run only in CLI first, with Web inspection later?
- Should legacy pruning support hard delete from live DB, or only archive-copy first?
