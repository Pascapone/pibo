# Ink CLI Terminal Rendering Parity: Initial Validation

**Date:** 2026-05-17

## Summary

This report records the first parity correction after the V2 QA finding that `/status` rendered as a top-level message instead of a Compact Terminal transcript result.

## Changes Validated

- `/status` appends an `execution.command` row followed by a `tool.status` row.
- The row result renders through shared `TerminalCardDescriptor` / `TerminalStatusViewModel` logic.
- Submitting `/status` while the room picker is open closes the picker and renders the result in transcript flow.
- Status card output includes owner/runtime/context/provider fields where available and redacts secrets.

## PTY Artifact

Command:

```bash
pibo debug pty run \
  --artifact \
  --artifact-dir /tmp/pty-status-flow-parity \
  --timeout-ms 30000 \
  --idle-timeout-ms 10000 \
  --cols 140 \
  --rows 36 \
  --wait-for "Select room" \
  --type "/status" \
  --press Enter \
  --wait-for "Status" \
  --expect "Command" \
  --expect "Ran /status" \
  --expect "Status" \
  --expect "Owner:" \
  --press CtrlC \
  -- node dist/bin/pibo.js tui:sessions
```

Artifacts:

```text
/tmp/pty-status-flow-parity/raw.ansi.log
/tmp/pty-status-flow-parity/clean.txt
/tmp/pty-status-flow-parity/screen.txt
/tmp/pty-status-flow-parity/events.jsonl
/tmp/pty-status-flow-parity/metadata.json
/tmp/pty-status-flow-parity/assertions.json
```

Final screen excerpt:

```text
✓ ▣ Command — command · done
 ↳ Ran /status
✓ ▣ Status — status · done
 ↳ Owner: Web user ...
 ↳ Runtime: local
 ↳ Context: unavailable — Context usage unavailable
 ↳ Provider quota: unavailable — Provider usage unavailable
```

## Automated Validation

```text
npm run typecheck: passed
npm test: 526/526 passed
npm run chat-ui:typecheck: passed
npm run chat-ui:build: passed
focused session-ui/Ink tests: passed
```

## Additional Render-Flow Coverage Added

- Shared row-builder test now verifies streaming row order, `running` state preservation, and `orderSource` / stream id / frame index metadata.
- CLI controller test now verifies `/status` preserves existing running assistant/tool rows and appends command/status rows after the live transcript tail.
- Web Compact Terminal source-level regression now verifies shared row builder usage, stable row ids, row/status/order data hooks, sticky follow-output, running-row streaming detection, and streaming footer wiring.

## Remaining Visual Debug Gap

PTY artifacts are currently text/ANSI based. A follow-up should add ANSI-to-HTML/SVG/PNG output or document a standard local renderer so reviewers can inspect a screenshot-like artifact.
