# Runtime Portability v4.1 Validation Report

**Date:** 2026-08-20
**Status:** In progress
**Branch:** `feature/runtime-portability-v4-1`
**Base:** `upstream/dev` at `a399dcd7`

## Scope

This report validates the Runtime Portability v4.1 change across capability contracts, Agent Designer persistence, native Codex compaction, checkpointed cross-runtime history transfer, adapter-native import, context discovery/deduplication, OMP additive prompt delivery, native-subagent controls, and selected-skill collision safety.

The Windows Better Auth migration remains in focused PR #523 and is not included in this branch. It is combined only in a disposable integrated Pibo2 candidate for final validation.

## Evidence rules

- Deterministic fixtures prove Pibo routing, protocol mapping, retry, bounds, redaction, and failure handling.
- Real OMP source/runtime checks prove the deployed harness actually consumes the configuration and append-prompt seams used by the adapter.
- Authenticated production-provider evidence is recorded separately and is never replaced by mock-provider evidence.
- No native credential files, cookies, authorization headers, login identifiers, account identifiers, or generated prompt contents are captured in this report.

## Implementation matrix

| Area | Implemented behavior | Primary evidence |
|---|---|---|
| Capability contracts | Required context-discovery, native-subagent, and history-import declarations with validation | `src/agent-runtime/capabilities.ts`, registry tests |
| Agent Designer | Capability-driven automatic-context state; native-subagent switch only when configurable; stale override clearing | Agent Store, Web API, and UI autosave tests |
| Native Codex compaction | Stable App Server v2 `thread/compact/start`; balanced lifecycle on success/start failure; truthful custom-instruction warning | Codex fixture and turn tests |
| Portable history | Pibo-owned, bounded, redacted, role/tool aware, aggregate-size bounded, routed-user filtered | `src/agent-runtime/portable-history.ts`, portability tests |
| Runtime rebinding | Explicit `startFresh`; fresh native target; source namespace stripping; pending/completed target-bound checkpoints; quiescence | Router portability tests |
| Pi import | `SessionManager.appendMessage` with compatible message shapes only | Pi portable-history test |
| Codex import | Stable `thread/inject_items` before first prompt | Codex turn fixture state |
| OMP import | Private append-only history section, persisted across process generations without transcript fabrication | OMP resource tests and real append-prompt check |
| Context deduplication | Canonical exact-path matching with Pi filesystem, Codex project-root/override, and OMP provider-specific boundaries | Resource-service boundary tests |
| OMP selected context | Private `--append-system-prompt` file; native context remains active and precedes additive context | OMP tests and real RPC state |
| Native subagents | Codex disables `multi_agent`, `multi_agent_v2`, and `agents.enabled`; OMP denies task approval and disables known native agents | Codex fixture; OMP config test; real model-initiated denial proof |
| Skill priority | Codex collision rejection unless selected path is verified; OMP custom-directory selected skill wins | Codex collision test; real OMP skill proof |

## Local validation

### Typecheck and builds

Command:

```text
NODE_OPTIONS=--max-old-space-size=1200 npm run typecheck
NODE_OPTIONS=--max-old-space-size=1200 npm run build
```

Result: passed on the exact final local tree on 2026-08-20. The default-heap typecheck can exhaust memory in the Chat UI stage; the repository-supported 1,200 MiB heap completed all root, workflow, Chat UI, Context Files UI, and VS Code checks and all production builds.

### Focused regression suite

A final focused run covered runtime registry/capabilities, resource delivery, store/UI/API behavior, portable history/rebinding, native Codex resources/turns, OMP resources, and the Chat Web channel.

Result: **183 passed, 0 failed** on the exact final local tree.

Notable added assertions include:

- aggregate serialized portable history stays at or below 1 MiB;
- accepted-but-never-routed user messages are excluded from handoff;
- source runtime model/options/native feature values do not cross namespaces;
- persisted handoffs contain matching source and target runtime identities;
- malformed or target-mismatched handoffs fail before adapter open;
- rebind quiescence prevents a message entering the source after checkpointing;
- Codex compaction start failure still emits one start and one terminal event;
- OMP single-skill custom-directory roots point at the parent that OMP scans;
- OMP cwd-only, nearest, every-ancestor, and repository-bound context behavior remains distinct.

### Canonical full suite

The canonical manifest contained all **310** sorted `test/*.test.mjs` and `test/chat-vscode/*.test.mjs` files. It ran exactly once in **16** isolated serial chunks through `scripts/run-test-suite.mjs --test-concurrency=1`; fresh process boundaries avoided the earlier signal-9 harness interruption without changing the explicit file set.

Result: **1,806 passed, 0 failed, 0 skipped, 0 cancelled**.

Manifest: `/tmp/pibo-portability-canonical-manifest.txt`
Per-chunk logs: `/tmp/pibo-portability-canonical-group-01.log` through `-16.log`
Aggregate summary: `/tmp/pibo-portability-canonical-summary.txt`

Earlier attempts that supplied only a Node concurrency option accidentally selected Node's recursive auto-discovery instead of Pibo's explicit canonical file list; they included workflow TypeScript sources and fixture executables and are discarded as noncanonical.

## Real OMP evidence

### Source checkpoint

- Source: `/opt/oh-my-pi`
- Commit: `f97a002dfa9b6b2dfafeb9fac549e4075d5c642e`
- Runtime package: `@oh-my-pi/pi-coding-agent` 17.3.5
- Bun: 1.3.14

Selected upstream source tests passed **27/27** across:

- append/system-prompt option routing;
- custom skill-directory first-wins priority;
- standalone `AGENTS.md` discovery;
- disabled/disallowed task preflight;
- task-agent capability descriptions.

### Additive prompt consumption

A disposable isolated OMP RPC session used a private generated config, native workspace `AGENTS.md`, and `--append-system-prompt`. Safe RPC state inspection proved:

- protocol negotiation succeeded;
- native context was present;
- additive Pibo context was present;
- native context preceded additive context;
- no stderr diagnostics occurred.

Only boolean outcomes were retained; prompt contents and paths were not captured.

### Model-initiated native-task suppression

A loopback deterministic provider instructed OMP to call its native `task` tool. The exact adapter policy shape (`tools.approval.task: deny` plus disabled native-agent names) was active.

Observed outcomes:

- the provider emitted a model-initiated `task` call;
- OMP returned the denial as a tool result to the model;
- the provider completed a second assistant response;
- the session returned idle;
- no subagent artifact was created;
- no stderr diagnostics occurred.

This is model-initiated harness evidence, not a direct tool invocation.

### Selected-skill priority

A real OMP RPC session exposed one ambient native skill and one Pibo-selected custom-directory skill with the same name. Safe system-state inspection proved the selected description was present and the native collision description was absent. This confirms OMP's custom-directory priority for the adapter's selected-skill layout.

## Security observations

### Portable state

- Entry count, per-entry text, aggregate serialized history, identifiers, and audit metadata are bounded.
- Shared redaction runs before portable serialization and bounded diagnostic persistence.
- Pending metadata records source and target runtime/adapter identities and fails closed on mismatch.
- Private OMP files use owner-only permissions and are removed/replaced on reset or stale-input cleanup.
- Runtime switches reject caller-supplied native target identifiers/locators.

### Packed artifact

`npm pack` rebuilt the exact final tree and produced an 807-file archive with no credential/config/database paths detected in its manifest. The installed archive passed CLI version discovery, fresh-home local gateway startup, public Chat shell HTTP 200, and clean SIGTERM shutdown.

- Archive: `/tmp/pibo-portability-final-package/pasko70-pibo-1.7.2.tgz`
- Size: 3,344,607 bytes
- Unpacked size: 12,760,908 bytes
- SHA-256: `688582d556908ac96db60d948b43eea76e3c71612b4017f3e6546c64326d0d71`
- CLI mode: executable

### Production dependency audit

The portability dependency tree currently reports **25 production advisories: 2 critical, 10 high, 10 moderate, and 3 low**. One critical/high cluster is the pre-migration Better Auth version and is removed by the separate exactly pinned Better Auth 1.6.30 branch. Remaining advisories require a separate dependency-hardening change because they span TanStack/Seroval, Pi/Undici, MCP/Hono/Express transitive packages, editor YAML, and build tooling. They are not silently treated as closed by this feature branch.

## Pibo2 integrated candidate

Pending:

- combine this branch with the exact PR #523 code in a disposable worktree;
- build and checksum the packed npm artifact;
- install that exact artifact on Pibo2 without merging either branch;
- validate public health/auth, Agent Designer controls, history rebinding, native Codex compaction/import, OMP context/skill/task behavior, restart continuity, and cleanup;
- retain sanitized browser/API/debug evidence.

## External release gates

- Direct Windows startup, compatible/unsafe SQLite recovery, rollback, restart idempotence, Windows-safe backup naming, and NTFS ACL behavior still require an actual Windows host.
- Remaining production dependency advisories require a focused dependency-hardening disposition.
- Merge, publication, release, and production-candidate replacement require explicit user authorization.
