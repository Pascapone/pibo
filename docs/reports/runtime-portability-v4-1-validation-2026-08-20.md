# Runtime Portability v4.1 Validation Report

**Date:** 2026-08-20
**Status:** PASS for implementation, focused/integrated validation, packaged deployment, and authenticated Pibo2 behavior. Direct Windows/NTFS validation remains an external release gate for the separately scoped Better Auth migration.
**Branch:** `feature/runtime-portability-v4-1`
**Base:** `upstream/dev` at `a399dcd7`
**Pull request:** #525

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

### Packed integrated artifact

The focused portability package above was superseded for deployment validation by a disposable integration of this branch, PR #523, the resource-reaper home-scope fix, and the dependency-hardening branch. The final integrated artifact was built from commit `b01becb068619e43ab3dcbafd894bbb6944d5b4d`.

- Archive: `/tmp/pibo-final-integrated-candidate-package-secure/pasko70-pibo-1.7.2.tgz`
- SHA-256: `eb6b18c72c5a9ac8489e24c32d3abf77967931b722616c752140c96043a38a84`
- Installed production audit: **0 advisories**
- Installed Pi Coding Agent: `0.84.2`
- Installed Better Auth: `1.6.30`
- Installed `js-yaml`: `4.3.1`
- MDX Editor present in production install: **no**
- Packed Pi credential-store write/read/delete round trip: passed
- Local Chat shell and bootstrap: HTTP 200
- CLI mode: executable

### Production dependency disposition

The focused portability branch intentionally does not mix dependency migration into its history. The separate `fix/production-dependency-hardening` branch resolves the original production advisory set without `npm audit fix --force`, migrates Pi to `0.84.2`, and keeps the browser-only MDX editor out of production installs. Both source-tree audits and the exact installed integrated artifact report zero advisories.

## Pibo2 integrated candidate

The checksum-verified integrated archive was activated as:

- candidate: `runtime-portability-v4-1-secure`;
- commit: `b01becb068619e43ab3dcbafd894bbb6944d5b4d`;
- gateway process: the immutable candidate path under `/opt/pibo-candidates`;
- public Chat shell and machine-authenticated bootstrap: HTTP 200;
- machine identity: authenticated, with 13 agents and 43 rooms visible to bootstrap.

Integrated local validation passed typecheck, production build, **216/216** focused tests, and **1,813/1,813** canonical tests across 311 files with zero failures, skips, or cancellations.

The authenticated `/api/chat/context-build` path reported Codex Native available and bound, `historyImport: true`, configurable native subagents, non-configurable native project context discovery, and `maintenance.compaction: true`, with zero snapshot warnings or errors. In the real headful Agent Designer, the selected Codex agent rendered the Native Subagents control enabled and off (`aria-pressed=false`), while automatic context discovery rendered checked but disabled with the explanation that Codex owns native discovery. The persisted agent record retained `nativeSubagents: false`.

### Runtime rebinding and persistence

Pibo2 session `ps_d37e43d8-4d8f-49b9-888e-bf698a9ab104` exercised portable rebinding in both directions. Its final Pi → Codex Native import remained persisted after live status synchronization and later gateway deployments:

- binding state: `bound`;
- runtime/adapter: `codex-native` / `codex-native`;
- protocol: `codex-app-server-v2` `0.147.0`;
- `portableHistoryLastImport.status`: `completed`;
- source runtime/adapter: `pi` / `pi`;
- target runtime/adapter: `codex-native` / `codex-native`.

The final candidate's debug trace contained six nodes, zero consistency diagnostics, and zero recorded failures. This directly covers the regression where a live binding refresh previously restored stale `pending` handoff metadata over the persisted completed audit state.

### Authenticated browser and provider evidence

The authenticated non-headless Pibo2 browser rendered the session in the real public Chat UI with a composer, Send control, runtime marker, and no console warnings or errors. CDP reported exactly one Chat page. Chrome remained on PID `1023085` with restart count `4` from `2026-08-20 11:07:47 UTC` through the final checks, providing more than three hours of continuous dwell evidence.

Exactly one bounded authenticated native-provider turn was performed during combined-candidate validation. It returned the expected `NATIVE CODEX READY` response through Codex Native, and its trace/failure checks were clean. The later dependency-packaging refresh changed no provider or runtime behavior, so the turn was deliberately not repeated solely for redeployment verification.

### Resource isolation

On the final candidate, a zero-grace dry-run classified the supervised profile `/dev/shm/pibo2-headful-browser/profile` as outside the active Pibo browser-use home and skipped it. The explicit profile exemption independently produced `action: skip` with reason `explicitly exempted browser user-data-dir`. Automatic reaper cycles from `2026-08-20 13:52:51 UTC` through `14:04:05 UTC` reported zero unmanaged browsers without changing the Chrome PID or restart count.

## External release gates

- Direct Windows startup, compatible/unsafe SQLite recovery, rollback, restart idempotence, Windows-safe backup naming, and NTFS ACL behavior still require an actual Windows host for the separately scoped Better Auth migration. No configured host in this environment provides Windows.
- Focused branches remain unmerged. No npm package was published and no release was created.
- Merge, publication, release, or permanent production replacement still require explicit authorization.
