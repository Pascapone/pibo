---
type: "Evidence Report"
title: "Shared Agent Management Tools Validation"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/agent-management-tools-validation.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "8de8da5d1d79831a987335a71608548e5625a4b7"
  source_bytes: 8537
  source_sha256: "d6a1b2f9315318cb9214899d63987b7f08a4026445a7a28f903ffd1b9618dcc5"
  source_body_sha256: "d6a1b2f9315318cb9214899d63987b7f08a4026445a7a28f903ffd1b9618dcc5"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:agent-management-tools-validation"
  published_at: "2026-09-01T07:57:34Z"
---
# Shared Agent Management Tools Validation

**Date:** 2026-08-23
**Pull request:** #556 (`piboschott:feature/subagent-agent-tools` → `upstream/dev`)
**Validated implementation commit:** `34c06971f2f72f316d0dcc8c73656c744b2be694`
**Candidate:** `pr556-agent-tools/34c06971f2f72f316d0dcc8c73656c744b2be694`
**Package:** `@pasko70/pibo@1.7.2`
**Package SHA-256:** `83e8df58292866cdf3cb9d1eb2b0afea4d5a72535d8dbd3b969db80634a8cd68`

This report supersedes the earlier validation of commit `0b5a3ca3`. That earlier package did not contain the final cursor, retention, cleanup-retry, compatibility, persisted-debug, portable-MCP, and regression-test fixes.

## Scope

Validate the replacement of generated runtime `pibo_subagent_*` tools with the stable shared surface:

- `pibo_agents_send_message`
- `pibo_agents_list_agents`
- `pibo_agents_observe`
- `pibo_agents_kill`

The review and validation also covered:

- foreground and yielded delegation;
- dynamic agent catalog and context inspection;
- parent ownership and child identity;
- descending cursor pagination without skipped observations;
- live retention-loss reporting and bounded normal/details output;
- kill retry after partial cleanup and cycle-safe descendant traversal;
- deprecated public library migration APIs;
- portable scoped-MCP execution through a non-Pi parent runtime;
- persisted debug CLI discovery and observation parity;
- trace materialization and the shared Agent Delegation UI;
- authenticated headful Pibo2 operation with a real model.

## Local verification

The validated implementation tree passed:

- `NODE_OPTIONS=--max-old-space-size=1200 npm run typecheck`
- `npm run build`
- `node scripts/run-test-suite.mjs`
- `git diff --check`

The complete test suite result was:

```text
tests: 1893
pass: 1893
fail: 0
cancelled: 0
skipped: 0
```

Focused regressions demonstrated:

- descending live cursor pages returned sequences `4,3` and then `6,5`, advancing cursors `4` and `6` without skipping;
- a cursor older than the 5,000-observation live retention window returned `truncated: true`;
- normalized text remained at or below 4 KiB and optional details were truncated at 32 KiB;
- `assistant_delta` normalized consistently as kind `message` in live and persisted inspection;
- a repeated kill retried subtree cleanup after an injected first-attempt failure;
- corrupt parent cycles terminated without duplicate descendants;
- deprecated `createSubagentToolName`, `createSubagentToolDefinitions`, runner types, and controller option shapes remained source-visible;
- deprecated runtime assembly failed with a direct `agentsController` migration instruction;
- historical `pibo_subagent_*` names remained recognizable without re-entering Pibo runtime assembly;
- the Codex native scoped-MCP fixture executed send, list, observe, kill, and yielded send against the shared controller;
- trace and Chat UI adapters preserved the selected `args.name` and child-session link.

`npm run check:product-vocab` remained blocked only by pre-existing baseline findings:

- generated Codex protocol schema occurrences of `principalId`;
- historical room tests containing `personal room`;
- one workflow-link test containing `Personal Chat`.

No changed PR #556 file was reported by that gate.

## Pibo2 exact candidate deployment

The package was checksum-installed under the separate remote Pibo2 development server and activated through the Pibo2 candidate helpers. Post-activation evidence showed:

- active candidate `pr556-agent-tools`;
- active commit `34c06971f2f72f316d0dcc8c73656c744b2be694`;
- gateway and public Chat Web readiness successful;
- remote gateway restart count remained zero after activation;
- active yielded runs returned to zero after validation;
- the supervised non-headless browser remained authenticated and resource-reaper exempt.

## Fresh-session context audit

A fresh `agent-tools-validation` Chat session was created through the authenticated headful UI:

```text
ps_fbe12802-b073-4803-af69-91b906169cd6
```

Authenticated `/api/chat/context-build` inspection returned:

- profile `agent-tools-validation`;
- Pi runtime available with zero context-build errors;
- exactly four `pibo_agents_*` tools;
- zero `pibo_subagent_*` runtime tools;
- all seven `pibo_run_*` tools;
- `pibo_agents_send_message.name.enum = ["explorer", "worker"]`;
- the exact explorer and worker descriptions in the send tool definition;
- all four shared management tools in `pibo_run_start.toolName.enum`.

## Real model and lifecycle validation

The fresh headful Chat Web session displayed `openai-codex/gpt-5.6-luna low`. One real model turn completed this ordered workflow:

1. Foreground `pibo_agents_send_message` to explorer.
2. Tracked yielded `pibo_agents_send_message` to worker.
3. Direct list of both child agents.
4. Wait and read of the yielded worker result.
5. Two descending, limit-one observe pages using the returned cursor.
6. Targeted worker kill by exact `agentId`.
7. Final list confirming explorer idle and worker killed.

Observed evidence:

| Item | Value |
|---|---|
| Explorer marker | `PR556_EXPLORER_OK` |
| Explorer agent ID | `ps_d2524395-b2cc-43d8-8ef4-a8b76189fdc9` |
| Worker marker | `PR556_WORKER_OK` |
| Worker agent ID | `ps_dc560e30-a525-4857-a641-754b3c6e4620` |
| Worker yielded run | `run_15d4fa6c-4b2b-4076-a170-57645344cb9d` |
| Observe page 1 | explorer, sequence `16`, cursor `16`, `truncated: true` |
| Observe page 2 | worker, sequence `29`, cursor `29`, `truncated: false` |
| Final explorer status | `idle` |
| Final worker status | `killed` |

The result proves that `order: desc` no longer selects the newest unseen record and advances past older unseen observations. It reverses only the oldest-unseen page, preserving a safe polling cursor.

## Persisted debug and trace validation

The exact candidate CLI exposed progressive discovery:

```text
pibo debug agents <parent-session-id> <command>
pibo debug agents <parent-session-id> list --help
pibo debug agents <parent-session-id> observe --help
```

The observe help explicitly documented oldest-unseen cursor pages and descending page reversal.

Persisted list inspection returned:

- explorer: `idle`, thread `pr556-foreground`;
- worker: `killed`, thread `pr556-yielded`.

Persisted descending cursor pages with `eventType = assistant_message` returned:

| Page | Agent | streamId | Marker | nextAfterSequence | truncated |
|---|---|---:|---|---:|---|
| 1 | explorer | `987377` | `PR556_EXPLORER_OK` | `987377` | true |
| 2 | worker | `987391` | `PR556_WORKER_OK` | `987391` | false |

`pibo debug trace ps_fbe12802-b073-4803-af69-91b906169cd6 --check` reconstructed:

- the foreground `pibo_agents_send_message` delegation linked to the explorer child;
- the yielded worker run and linked async-agent node;
- both observe calls, list calls, wait/read, and kill;
- `nodeErrors: 0`;
- `checks: ok`;
- `issues: 0`.

`pibo debug failures ... --json` returned an empty failure list.

## Headful UI and browser evidence

The real non-headless Pibo2 browser rendered:

- `agent-tools-validation`, Pi bound, and `gpt-5.6-luna low`;
- an Explorer Agent Delegation card linked to its child session;
- the yielded worker run and all management tool calls;
- both child reply markers;
- the two cursor-page names, sequences, cursors, and truncation flags;
- final explorer `idle` and worker `killed` statuses.

A viewport screenshot was captured from the supervised headful browser. Chrome DevTools reported:

- no console warnings or errors;
- no failed or 4xx/5xx requests in the inspected request list;
- authenticated machine-key bootstrap remained active;
- Chrome, Xvfb, Openbox, CDP, and the browser profile exemption remained healthy.

## Final-head handling

The only planned commit after the validated implementation commit is this report/status update. After that documentation-only commit, the exact resulting PR head is rebuilt, checksum-installed, activated on Pibo2, and rechecked through the same authenticated context, model, debug, trace, console, and UI path before merge. The merge gate uses the exact GitHub PR head SHA rather than assuming the implementation commit remains the head.

## Result

The reviewed implementation satisfies the stable shared agent-management contract, lifecycle and ownership boundaries, retention and cursor semantics, compatibility path, portable-MCP delivery, persisted debug behavior, trace/UI linkage, CLI discoverability, bounded output requirements, and authenticated headful Pibo2 user path.
