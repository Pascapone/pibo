---
type: "Reference"
title: "Observability Telemetry Rollout Verification"
description: "Summarizes the required verification and safety checks for observability telemetry rollout."
tags: ["observability", "telemetry", "verification"]
status: "draft"
authority: "informative"
migration_lineage:
  source_path: "docs/project/observability-telemetry-rollout-verification.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "1383d52c6a28064b5da671fb8072319e02d88317"
  source_bytes: 4140
  source_sha256: "8ce41971ef8ef8074c98e9809a1c384519460991355f6443103e90bab340d6dd"
  source_body_sha256: "8ce41971ef8ef8074c98e9809a1c384519460991355f6443103e90bab340d6dd"
generated:
  by: "process:pibo-okf-p-current-project-plans"
  at: "2026-08-31T22:47:46Z"
---
# Observability Telemetry Rollout Verification

Use this checklist before enabling observability telemetry outside local development. It covers the change set in `docs/specs/changes/pibo-observability-debug-telemetry/` and the capability specs `docs/specs/capabilities/runtime-observability-telemetry.md` and `docs/specs/capabilities/debug-cli.md`.

## Scope boundaries

- Telemetry is diagnostic evidence, not runtime recovery.
- Automatic timeout detection, abort, retry, and provider recovery remain separate work.
- V1 stores metadata, counters, timings, ids, links, byte counts, and safe structural fields. It must not store full provider bodies, full transcripts, normalized event payload dumps, or full tool arguments by default.

## Required checks

Run these checks in the Docker worker used for the branch:

```bash
docker exec pibo-dev-ralph-observability-telemetry bash -lc 'cd /workspace && npm run typecheck'
docker exec pibo-dev-ralph-observability-telemetry bash -lc 'cd /workspace && npm test'
```

Then verify the synthetic stuck-session drill-down with fixture-backed tests or a seeded local store:

```bash
pibo debug telemetry session <pibo-session-id> --json
pibo debug telemetry turn <turn-id> --json
pibo debug telemetry provider <provider-request-id> --json
pibo debug telemetry provider <provider-request-id> events --limit 20 --json
pibo debug telemetry tool <tool-call-id> --json
```

Confirm each result contains next-command metadata and omits raw provider bodies, full transcript text, normalized event payloads, and full tool arguments.

## Bounded output and storage safety

Verify these behaviors before rollout:

- `sessions`, `turn`, and provider event list commands enforce default limits and hard maximums.
- Provider event output includes cursor or `nextAfterSequence` metadata when more rows exist.
- `--fields` returns allowlisted provider event fields only.
- Large fake provider payloads, transcripts, and tool arguments do not appear in default text or JSON output.
- Telemetry rows link to sessions/events/payload metadata instead of duplicating full content.

## Stale hints and thresholds

Verify stale output shows the applied threshold and source:

```bash
pibo debug telemetry stale --limit 20
pibo debug telemetry stale --threshold-ms 60000 --json
```

Also verify live status surfaces expose only compact telemetry hints when available:

```bash
pibo gateway dev status
curl -fsS http://127.0.0.1:4802/gateway/status
```

Expected hints include active phase, turn id, last progress time, stale age, queue depth, threshold, and source. They must omit provider payloads, headers, transcripts, normalized event payloads, and full tool arguments.

## Retention and preview behavior

Verify stats, dry-run pruning, explicit apply, and preview-unavailable behavior:

```bash
pibo debug telemetry stats
pibo debug telemetry stats --retention provider_event --json
pibo debug telemetry prune --retention provider_event --before <iso-date>
pibo debug telemetry prune --retention provider_event --before <iso-date> --json
pibo debug telemetry provider <provider-request-id> payload <preview-or-event-summary-id> --json
```

The prune command must dry-run unless `--apply` is present. Preview commands must return disabled/unavailable by default and must not read arbitrary raw payload content.

## Backward compatibility

Run the existing debug CLI tests and spot-check non-telemetry debug branches:

```bash
pibo debug --help
pibo debug db stores
pibo debug session <pibo-session-id> --json
pibo debug trace <pibo-session-id> --check
pibo debug events <pibo-session-id> --limit 5
```

Existing debug output contracts must remain compatible. Telemetry adds a branch; it must not change unrelated session, trace, event, job, run, signal, or database diagnostics.

## Traceability

- PRD 01: product guardrails and rollout checklist.
- PRD 02: telemetry store, redaction, retention, prune, and preview-unavailable contract.
- PRD 03: runtime, provider, and tool capture.
- PRD 04: `pibo debug telemetry` command surface.
- PRD 05: signals, stale detection, fixtures, playbooks, and final validation.
