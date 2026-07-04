# Proposal: Telemetry Opt-In Archive Isolation

**Status:** Draft
**Created:** 2026-07-04
**Requester / Source:** Production incident on `194.164.197.30` after Pibo 1.6 telemetry retention blocked the web gateway
**Related docs:**

- `docs/specs/changes/chat-web-trace-v2-fast-path/`
- `docs/specs/changes/pibo-observability-debug-telemetry/`
- `docs/specs/capabilities/runtime-observability-telemetry.md`
- `docs/specs/capabilities/data-maintenance-cli.md`
- `docs/specs/capabilities/pibo-data-store-and-ingestion.md`

## Why

Pibo currently stores detailed runtime/provider telemetry as part of the live system. On the production server, the live database grew to roughly 26 GB plus an 8.3 GB WAL. The `telemetry_provider_events` table contained about 16.9 million rows. A manual or automatic retention operation against that data ran inside the production web gateway, blocked health checks, consumed more than 12 GB of service memory, and made the Web UI unavailable.

This failure mode is unacceptable. Debug telemetry is useful, but Pibo needs it rarely. The gateway and normal Chat Web experience must not depend on debug telemetry tables, large provider-event scans, or retention maintenance. Pibo should run without detailed telemetry by default. Operators should enable telemetry only when they need to investigate a specific session, room, runtime, or short time window.

## What Changes

Pibo will move from always-on live telemetry to explicit telemetry capture runs:

1. Detailed telemetry is off by default.
2. Operators explicitly start a telemetry run with scope, detail level, and optional time/size limits.
3. Active telemetry writes to an isolated telemetry database or archive directory outside the live gateway database.
4. Stopping telemetry finalizes and archives the run.
5. Archived telemetry is not opened, migrated, scanned, retained, or loaded by the gateway unless an operator explicitly asks to inspect it.
6. Retention/deletion of telemetry archives runs outside the gateway and must be cancellable, observable, and bounded.

Normal operational data remains available. Pibo still persists rooms, sessions, messages, visible session events, status, minimal errors, and job state. The change removes only verbose debug/provider telemetry from the always-on hot path.

### Follow-up Finding: Hot Operational Streams Also Need Bounds

A later local OOM investigation found that the larger local store was not `telemetry_provider_events`, but `pibo-events.sqlite`. Its `pibo_event_stream.payload_json` contained hundreds of MB of `pibo.output` events, including multi-MB `tool_execution_finished` payloads. This means the change must not focus only on tables named `telemetry_*`.

The live operational/reliability stream is allowed to keep status and replay envelopes, but it must not keep unbounded payload bodies inline. Large output bodies need payload references, previews, and explicit lifecycle controls. Otherwise Pibo can disable detailed telemetry and still OOM through reliability replay, trace caches, debug routes, or SSE reconnects.

## Capabilities

### New Capabilities

- `telemetry-capture-runs`: explicit telemetry capture lifecycle with start, active, stop, archive, inspect, export, and delete states.
- `telemetry-archive-store`: isolated telemetry databases or archive directories that are never part of the live gateway data path unless mounted for explicit inspection.
- `telemetry-runtime-toggle`: runtime settings and APIs to enable telemetry for selected scopes and duration.
- `telemetry-archive-maintenance`: bounded archive deletion/retention tooling outside the gateway.

### Modified Capabilities

- `runtime-observability-telemetry`: becomes opt-in for verbose provider/runtime telemetry. It keeps only bounded operational summaries when telemetry is disabled.
- `pibo-data-store-and-ingestion`: separates live operational data from debug telemetry data.
- `debug-cli`: gains commands to list, inspect, export, and delete telemetry archives without loading them into normal Chat Web.
- `chat-web-settings-area`: exposes telemetry state and archive controls without running long deletes in the request path.
- `data-maintenance-cli`: handles archive retention and compaction as worker/CLI jobs, not gateway requests.

## Impact

### Product Impact

- Default Pibo installs no longer accumulate detailed provider/debug telemetry.
- Operators gain an explicit debugging workflow: start capture, reproduce issue, stop capture, inspect archive, delete archive.
- Chat Web remains usable even when old telemetry archives are large.
- Telemetry inspection becomes deliberate and local to an archive, not part of every gateway startup or request.

### Code Impact

- Introduce a telemetry capture manager that owns active run state.
- Replace unconditional telemetry writes with a gate that checks active capture scope and detail level.
- Move verbose telemetry tables out of `pibo.sqlite` or make them inactive legacy data only.
- Add archive manifest files with metadata, schema version, size, row counts, scope, and retention policy.
- Add migration logic for existing installations with large live telemetry tables.
- Add CLI and Web APIs for capture lifecycle and archive management.

### Data Impact

- Live stores keep only operational data needed for the UI and runtime state.
- Active telemetry writes to separate files such as:

```text
$PIBO_HOME/telemetry/active/<run-id>/telemetry.sqlite
$PIBO_HOME/telemetry/archives/<run-id>/manifest.json
$PIBO_HOME/telemetry/archives/<run-id>/telemetry.sqlite
```

- Existing verbose telemetry in `pibo.sqlite` must be handled by a migration path. The migration must not block the gateway.

### Security / Privacy Impact

- Verbose telemetry can contain provider payloads, tool arguments, file paths, prompts, snippets, and error content. It must be opt-in, scoped, discoverable, and easy to delete.
- Archive inspection must be local/admin-only unless a future access-control spec explicitly permits remote inspection.

## Relationship to Trace V2

Trace V2 owns the default Chat Web trace transport: compact timeline rows, payload refs, raw events as a separate debug API, and lazy payload access. This telemetry proposal owns detailed telemetry capture and archive isolation. Both changes share one rule: no verbose/debug payload may live unbounded in the gateway hot path.

## Non-Goals

- This proposal does not remove normal chat/session persistence.
- This proposal does not remove minimal operational events needed to render Chat Web.
- This proposal does not require external observability services.
- This proposal does not require Docker.
- This proposal does not define the full resource-isolation model; that is covered by `gateway-resource-protection-workers`.

## Risks

- Debugging may be harder if telemetry is not enabled before an incident. Mitigation: keep minimal bounded operational breadcrumbs always on.
- Existing telemetry tables may be too large to migrate online. Mitigation: treat them as legacy archives and provide offline cleanup tools.
- Accidentally loading telemetry archives in the gateway can recreate the failure. Mitigation: enforce archive access through explicit inspect jobs and tests.

## Success Definition

The change succeeds when a default Pibo install can run for long periods without growing detailed provider telemetry, and when a large telemetry archive cannot block gateway startup, health checks, Chat Web navigation, or normal session use.
