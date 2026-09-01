---
type: "Historical Record"
title: "Chat Web Subagent Run E2E Retest Report"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/chat-web-subagent-run-e2e-retest-report.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "9335529dfc1860aaacb9ee156c2973a331adf14d"
  source_bytes: 5949
  source_sha256: "365bb79031d483245a787d4084bf86ba94de09ec41851351d85718be8f83c02f"
  source_body_sha256: "365bb79031d483245a787d4084bf86ba94de09ec41851351d85718be8f83c02f"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Web Subagent Run E2E Retest Report

Date: 2026-05-01

## Scope

Retest after fixing the findings from `docs/chat-web-subagent-run-e2e-test-report.md` and implementing the hardening plan in `plans/harden-chat-web-subagent-run-e2e.md`.

The retest covered:

- direct subagent delegation from a Chat Web `main-agent` session
- async subagent delegation through `pibo_run_start`
- trace rendering for parent and child sessions
- debug CLI trace and event reads during an active streamed run
- completed child trace header state after browser reload
- trace panel horizontal overflow at `880x847`
- `pibo.output` `live_delta` inspection through the debug CLI

## Setup

- App: `http://4788.192.168.0.204.sslip.io/apps/chat`
- Browser automation: `browser-use --session pibo-auth`
- Gateway: `npm run gateway:web`
- Parent profile: `main-agent`
- Subagent profile: `sub-agent`
- Fix commit under test: `cc31dcf Harden chat web subagent traces`

Prompt:

```text
Ich möchte, dass du einen Subagent beauftragst, sich seinen Workspace anzuschauen und dir einen Überblick über das Projekt zu geben. Gebe mir dann davon das TLDR. Starte den ersten Agent direkt und dann im Anschluss einen über `pibo_start_run`.
```

The model again treated `pibo_start_run` as the actual tool `pibo_run_start`.

## Test IDs

- Parent session: `ps_780cee7d-4081-4f71-bb06-cd92ef6f1173`
- Direct subagent sessions:
  - `ps_9209c193-da0f-461d-9ad1-2b7e2063320a`
  - `ps_5b284a14-54be-4d7a-bda2-857396ff2759`
- Async subagent sessions:
  - `ps_bf7fde69-9152-4eac-96b5-8d3c748c26b4`
  - `ps_33791ebe-9e40-4a75-95b9-9f41cdaa736d`
- Completed async runs:
  - `run_4bdd7950-a49c-46a8-aedb-b9e47ab3b98a`
  - `run_51a5a6b8-25a5-4882-b543-382f379c0904`

The model performed extra direct and async subagent calls to recover from an initially plan-like subagent answer. This did not invalidate the E2E path; it exercised the same parent/child trace and run-control behavior more than once.

## Results

Passed:

- Chat Web created a new `main-agent` session.
- Prompt submission worked.
- Direct subagent calls rendered as `Agent Delegation`.
- Async subagent calls rendered as `Async Agent`.
- `pibo_run_start`, `pibo_run_wait`, and `pibo_run_read` appeared in the parent trace.
- Parent trace completed and produced a final project TLDR.
- Durable async runs finished as `completed` and `consumed: true`.
- Parent debug trace returned `status: "done"` and `checks.status: "ok"`.
- Async child debug trace returned `status: "done"` and `checks.status: "ok"`.
- Browser reload preserved completed trace state.

## Finding Verification

1. Debug CLI lock during active writes: fixed.
   - During the active run, repeated `debug trace --check --json` and `debug events --json` calls completed without `database is locked`.

2. Stale/misleading child trace active status: fixed.
   - Completed child session `ps_33791ebe-9e40-4a75-95b9-9f41cdaa736d` showed `22 Done` / `sub-agent`.
   - The page did not show `Active main-agent`.
   - Browser text check returned no active-status matches.

3. Trace panel horizontal overflow: fixed.
   - Browser viewport: `880x847`.
   - `document.documentElement.scrollWidth`: `880`.
   - `document.documentElement.clientWidth`: `880`.
   - No app-wide horizontal overflow was present.

4. High `live_delta` volume: operational path added and verified.
   - `pibo debug events stats --topic pibo.output --session ps_780cee7d-4081-4f71-bb06-cd92ef6f1173 --retention live_delta --json` returned a count for the parent session.
   - Observed parent `live_delta` count after retest: `612`.
   - `pibo debug events prune` is covered by automated tests and documented in `docs/architecture.md`.

Additional regression found during retest:

- A stale streamed `tool_call` delta could remain as an orphan trace node after transcript persistence, causing `debug trace --check` to warn about a missing parent.
- This was fixed during the retest by ignoring stale `tool_call` echo events once a persisted transcript exists and the selected session is no longer running.
- Regression coverage was added in `test/chat-trace.test.mjs`.

## Verification Commands

```bash
npm run typecheck
npm run build
node --test test/chat-trace.test.mjs test/debug-cli.test.mjs test/reliability-store.test.mjs
npm test
```

Final automated result:

```text
npm test
tests: 147
pass: 147
fail: 0
```

Manual debug checks:

```bash
node dist/bin/pibo.js debug trace ps_780cee7d-4081-4f71-bb06-cd92ef6f1173 --check --json
node dist/bin/pibo.js debug trace ps_33791ebe-9e40-4a75-95b9-9f41cdaa736d --check --json
node dist/bin/pibo.js debug runs list ps_780cee7d-4081-4f71-bb06-cd92ef6f1173 --json
node dist/bin/pibo.js debug events stats --topic pibo.output --session ps_780cee7d-4081-4f71-bb06-cd92ef6f1173 --retention live_delta --json
```

Final debug summary:

```json
{
  "parent": {
    "status": "done",
    "checks": "ok",
    "nodes": 20
  },
  "child": {
    "status": "done",
    "checks": "ok",
    "nodes": 22
  },
  "runs": [
    {
      "runId": "run_4bdd7950-a49c-46a8-aedb-b9e47ab3b98a",
      "status": "completed",
      "consumed": true,
      "toolName": "pibo_subagent_sub_agent"
    },
    {
      "runId": "run_51a5a6b8-25a5-4882-b543-382f379c0904",
      "status": "completed",
      "consumed": true,
      "toolName": "pibo_subagent_sub_agent"
    }
  ],
  "liveDeltaStats": [
    {
      "topic": "pibo.output",
      "key": "ps_780cee7d-4081-4f71-bb06-cd92ef6f1173",
      "retentionClass": "live_delta",
      "count": 612
    }
  ]
}
```

Browser layout/status check:

```json
{
  "hasActiveMainAgent": false,
  "activeMatches": null,
  "docScrollWidth": 880,
  "clientWidth": 880,
  "bodyOverflowX": "visible"
}
```

## Remaining Notes

- The Vite build still reports the existing chunk-size warning for the Chat UI bundle. This is not related to the E2E findings and did not fail the build.
- No unresolved E2E issues remained after the retest.
