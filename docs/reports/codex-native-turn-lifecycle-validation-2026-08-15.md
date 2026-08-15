# Native Codex Turn Lifecycle Validation — 2026-08-15

## Scope

This report records native Codex checkpoint 9.5 for `@pasko70/pibo@1.7.2` at implementation commit `714ece6ace7239d0a04153e99fa1ecabeccd0374`.

The checkpoint adds stable Codex App Server v2 turn execution behind the existing runtime-adapter contract:

- `turn/start` for Pibo text prompts;
- `turn/steer` for an active native turn;
- `turn/interrupt` for abort;
- assistant, reasoning, native-item/tool, usage, warning, completion, interruption, and failure normalization;
- completed-turn in-memory thread reconciliation so history, fork candidates, and process restart resume reflect the new native turn;
- bounded process/protocol failure settlement and event redaction.

The implementation uses official JSONL JSON-RPC notifications from Codex App Server. It does not parse terminal output and does not use the Pi Codex-compatibility prompt or model loop.

## Implemented contract

`CodexNativeTurnController` owns one active native turn for a live adapter session. It subscribes to the adapter-owned App Server client before prompts begin, correlates notifications to the exact native thread and turn, and settles `prompt()` only after a terminal `turn/completed` notification or a terminal process/protocol failure.

The checkpoint advertises only the newly proven surfaces:

- text input;
- active-turn steering;
- assistant deltas and final messages;
- reasoning lifecycle and deltas;
- native tool lifecycle events;
- per-turn usage;
- completion, interruption, and failure.

Images, audio, structured output, plans, diffs, raw native events, model/reasoning selection, approvals, structured user input, Pibo MCP tools, external MCP, skills, context, and context-usage inspection remain unadvertised until their later checkpoints.

### Stable notification mapping

| Codex App Server surface | Pibo semantic output |
|---|---|
| `turn/started` | `turn_started` |
| `item/agentMessage/delta` | `assistant_delta` |
| completed `agentMessage` item | `assistant_message` |
| reasoning item plus summary/raw deltas | `reasoning_started`, `reasoning_delta`, `reasoning_finished` |
| command, file-change, MCP, dynamic, web-search, image, sleep, and collaboration tool items | `tool_call`, `tool_execution_started`, `tool_execution_updated`, `tool_execution_finished` |
| `thread/tokenUsage/updated` | one terminal `usage` event using the latest per-turn breakdown |
| context-compaction item | `compaction_start`, `compaction_end` |
| retrying `error` notification | `warning` |
| non-retrying `error` notification | normalized `error`, followed by one terminal `turn_failed` |
| terminal `completed` or `interrupted` turn | `turn_completed` with the native terminal status |
| process exit or malformed active-turn notification | one `turn_failed`, rejected prompt, and bounded client shutdown |

Generic `RuntimeRoutedSession` then maps the assistant, reasoning, tool, usage, compaction, and error semantics into the existing Pibo product event contract with the active Pibo input event id. No Codex-specific branch was added to generic orchestration.

## Deterministic validation

The exact-version fixture now models durable materialization after a first turn and supports:

- notification-before-response ordering;
- assistant and reasoning deltas plus authoritative completed items;
- command, file-change, and MCP tool progress/results;
- multiple usage updates reduced to one per-turn terminal value;
- active-turn steering;
- interruption;
- provider failure with retry and non-retry notifications;
- malformed notification shutdown;
- process crash;
- foreign and duplicate notification suppression;
- process restart and resume of a completed native turn.

Primary coverage:

- `test/codex-native-turn.test.mjs`
- `test/codex-native-thread.test.mjs`
- `test/fixtures/codex-app-server-thread-fake.mjs`
- reusable `exerciseAgentRuntimeAdapterContract`

Final focused Codex protocol/client/process/thread/turn suite:

- 38 tests;
- 38 passed;
- 0 failed.

Final workspace validation:

- `npm run typecheck` — passed;
- `npm run build` — passed;
- canonical full suite — 1,698/1,698 passed across 12 suites;
- `git diff --check` — passed.

## Exact Codex 0.147.0 validation on Pibo2

The committed implementation was packed as `@pasko70/pibo@1.7.2` and installed into an isolated verification prefix before execution.

Validated artifacts:

- implementation commit: `714ece6ace7239d0a04153e99fa1ecabeccd0374`;
- package SHA-256: `c969c037953503d4ae30f2ebcfbae455d3bb05c860117bb3b6a2e14df2cee8f1`;
- Codex CLI/App Server: `0.147.0`;
- exact Codex native binary SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`.

The exact binary used an isolated loopback Responses-compatible provider with deterministic SSE. No local, transferred, or target-managed OAuth/API credential was read, copied, or emitted. This validates the official App Server turn protocol and adapter normalization without weakening the private-home boundary; authenticated product integration remains a later checkpoint.

Exact scenarios passed:

1. Runtime diagnostics and exact-version acceptance.
2. Fresh thread plus normal turn with streamed reasoning, assistant deltas, final assistant message, and usage.
3. A native `shell_command` model loop with command item start/output/completion, followed by a second model response and final assistant message.
4. Active-turn `turn/steer` accepted against the exact expected turn id.
5. `turn/interrupt` produced terminal `interrupted`, settled the prompt, and left the session non-streaming.
6. Adapter child-process shutdown and restart resumed the same completed native thread and continued with another turn.
7. Exact provider failure produced one redacted terminal `turn_failed` and no successful terminal event.
8. Five canonical native turns were available as fork candidates after the scenarios.

Exact package timings:

| Scenario | Elapsed |
|---|---:|
| Normal streamed turn | 70 ms |
| Native command tool loop | 140 ms |
| Interrupt settlement | 8 ms |
| Child-process restart, resume, and next turn | 224 ms |
| Provider failure settlement | 49 ms |
| Exact validation scenario total | 879 ms |
| Validation process wall time including setup/cleanup | 1,060 ms |

Cleanup and isolation checks passed:

- Codex App Server process count was `0` before and `0` after;
- the active `pibo-web.service` process remained unchanged;
- the global Codex home directory modification time remained unchanged;
- all temporary exact-validation roots were removed;
- no binding locator, transcript path, config value, credential, token, account metadata, or native home path was emitted.

## Security and failure behavior

- Sensitive text patterns are redacted in assistant/reasoning/tool/error output.
- Structured tool values redact sensitive keys such as tokens, credentials, cookies, API keys, secrets, and passwords recursively.
- Native command working directories are not copied into normalized tool-call arguments.
- Diagnostic text is bounded and removes filesystem paths before entering Pibo events.
- Usage is emitted once at terminal settlement using the latest per-turn values, preventing cumulative updates from being double-counted by product accounting.
- Foreign-thread events, stale-turn events, duplicate item completion, and duplicate terminal notifications are ignored.
- A malformed active-turn notification fails closed, emits one terminal failure, and closes the owned App Server process.
- Disposal removes subscriptions before process shutdown, preventing post-disposal runtime events.

## Deliberate boundary after checkpoint 9.5

This checkpoint does not register a built-in `codex-native` configured instance or profile and does not reinterpret the existing Pi-backed compatibility meaning of `codex`.

Still pending:

- command/file approvals and structured user input (9.6);
- model, reasoning, service-tier, adapter options, and context-usage inspection (9.7);
- Pibo MCP tools, external MCP, skills, and context delivery (9.8);
- broader native-tool inspection and integrated product evidence (9.9);
- Pibo-managed subagents (9.10);
- distinct profile/Designer registration (9.11);
- authenticated public gateway, Chat Web, and `pibo-web.service` restart validation (10.4 and later integrated tasks).

## Result

Task 9.5 is complete. Native Codex turns now start, stream, steer, interrupt, complete, fail, update durable thread state, and normalize into Pibo semantic/product events through the official Codex App Server `0.147.0` stable v2 protocol. Capability claims remain limited to the surfaces proven by deterministic fixtures and exact-binary Pibo2 evidence.
