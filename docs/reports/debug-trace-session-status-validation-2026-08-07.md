# Debug trace session-status validation — 2026-08-07

## Result

The focused candidate correctly separates live session lifecycle from historical trace-node failures. It also resolves stale session-store rows from persisted lifecycle events without requiring a gateway connection.

## Candidate

- Branch: `fix/debug-trace-session-status`
- Commits:
  - `5329eb23 fix(debug): separate trace lifecycle from node errors`
  - `3eedc359 fix(debug): derive trace lifecycle from persisted events`
- Immutable server install: `/opt/pibo-candidates/debug-trace-session-status/3eedc359`
- Validation mode: direct CLI execution against `/root/.pibo`; the production gateway was not switched to this candidate.

## Local verification

- Full build: passed.
- Typechecks: root, Chat UI, Context Files UI, and VS Code passed.
- `test/debug-cli.test.mjs` plus `test/debug-trace-status.test.mjs`: 70 tests passed.
- `git diff --check`: passed.

The tests cover:

- idle session plus historical failed tool node → `done` with non-zero `nodeErrors`;
- stale idle session row plus newer `message_started` → `running` from `event-log`;
- newer `message_finished` → `done` from `event-log`;
- terminal session failure → `error`;
- failed nodes remain present and continue to drive `pibo debug failures` drill-down.

## Real Pibo2 evidence

Session: `ps_03bb744d-0cb8-43b6-9900-c3b0e110b43c`

During the independent Stream Lab audit turn, the production gateway reported `processing=true` and `streaming=true`. The candidate CLI returned:

```json
{
  "status": "running",
  "statusSource": "event-log",
  "errorNodeCount": 7,
  "nodeCount": 489,
  "runningNodes": 1
}
```

The active lifecycle was derived from the latest persisted `message_started` event even though the session-store row had previously lagged at idle.

After persisted `message_finished` stream ID `954279`, while the gateway reported `processing=false` and `streaming=false`, the same candidate returned:

```json
{
  "status": "done",
  "statusSource": "event-log",
  "errorNodeCount": 7,
  "nodeCount": 502,
  "runningNodes": 0
}
```

The seven historical failed tool nodes remain explicit but no longer mislabel the successfully completed session as a terminal error.

## Operational conclusion

`status` now means lifecycle, `statusSource` explains whether persisted lifecycle events or the session store supplied it, and `errorNodeCount` reports recoverable or historical node failures separately. `pibo debug failures` remains the detailed error inventory.
