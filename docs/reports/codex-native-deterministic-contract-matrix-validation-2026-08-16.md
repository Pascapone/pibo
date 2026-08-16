# Native Codex Deterministic Contract Matrix Validation — 2026-08-16

## Scope

This report closes native Codex tasks 9.12 and 9.13 at shared-contract implementation commit `b5aaf4f8` on the branch stacked above native-profile PR #501.

The checkpoint consolidates the deterministic fixture evidence accumulated across Codex checkpoints 9.1–9.11 and strengthens the reusable runtime-adapter contract so a nominally successful adapter cannot pass while unhealthy, terminally failed, out of order, or changing product routing identity.

## Shared adapter contract

`exerciseAgentRuntimeAdapterContract()` now requires the valid fixture path to prove:

- the enabled configured adapter reports no error diagnostic;
- profile validation reports no error;
- the opened session matches configured instance, adapter, workspace, and Pibo Session binding identity;
- one prompt emits exactly one `turn_started` followed by exactly one `turn_completed`;
- no `turn_failed` event appears on the happy path;
- the prompt settles with `streaming: false`;
- Pibo Session id, runtime instance id, and adapter id remain stable after the turn;
- idle abort leaves the runtime non-streaming;
- unsubscription and repeated disposal remain safe.

The deterministic fake adapter and native Codex fixture both pass the same helper. Negative fixtures prove the helper rejects an unhealthy adapter diagnostic and a failed nominal prompt rather than accepting either as a valid contract run.

## Deterministic fixture matrix

| Required surface | Deterministic evidence |
|---|---|
| Generated stable protocol checkpoint | `test/codex-native-protocol-checkpoint.test.mjs` verifies pinned full/v2 schemas, hashes, required stable methods/fields, and absence of invented native-tool inventory methods. |
| Typed stdio startup and correlation | `test/codex-native-client.test.mjs` verifies initialize/initialized ordering, no wire `jsonrpc` header, out-of-order correlation, notifications, and server requests. |
| Overload and resource bounds | Client fixtures verify bounded `-32001` retries/exhaustion, pending limits, request timeout/abort, inbound/outbound message bounds, backpressure ordering, stderr bounds/redaction, and bounded shutdown. |
| Malformed protocol | Client fixtures reject malformed JSON and bad initialization; turn fixtures reject malformed stable item payloads and emit one redacted terminal failure. |
| Process crash and startup failure | Client, process, turn, and request fixtures cover spawn failure, initialize failure, process exit with pending work, App Server start failure, turn crash, and pending-request cleanup. |
| Process/home isolation | `test/codex-native-process.test.mjs` covers exact/compatible/unsupported/missing version probes, private instance/session generations, protected environment, home mismatch, explicit experimental input config, cleanup, and privately isolated diagnostic probes. |
| Thread lifecycle and missing native state | `test/codex-native-thread.test.mjs` covers start/bind/resume, empty-thread durability, exact missing errors, no replacement thread, list/read/fork, revisioned CAS, router restart, and deletion-to-`missing`. |
| Native history | Thread fixtures verify normalization, pagination, redaction, binding-scoped cursors, invalid cursor rejection, and unavailable-history inspection. |
| Turn output and abort | `test/codex-native-turn.test.mjs` covers assistant/reasoning/usage/tool items, terminal ordering, durable restart replay, steer, active interrupt, provider failure, malformed event, process crash, and foreign/duplicate notifications. |
| Command/file approvals | `test/codex-native-requests.test.mjs` covers scoped opaque ids, redaction, decisions, invalid decisions, cancellation, routing through generic actions, and at-most-once resolution. |
| Structured user input | Request/process fixtures verify explicit experimental opt-in, disabled behavior, schema/answer validation, secret-answer non-projection, malformed/foreign requests, generic routed response, interrupt cleanup, and crash cleanup. |
| Models/options/usage | `test/codex-native-models.test.mjs` covers paginated model catalog, model-specific reasoning/tier intersections, stable settings, invalid options/providers, live controls, usage replay, and restart continuity. |
| Portable resources and failure cleanup | `test/codex-native-resources.test.mjs` covers Pibo/external MCP, skills/context, native prompt preservation, active renewal, idle process handoff, unverified-delivery failure, token revocation, and generation cleanup. |
| Pibo-managed subagents | `test/codex-native-subagents.test.mjs` covers Codex-parent and Pi-parent cross-runtime children, direct/yielded invocation, binding reuse, restart, cancellation, and scoped MCP visibility. |
| Generic import boundary | `test/agent-runtime-boundaries.test.mjs` prevents generic runtime/router/history modules from importing Pi, Codex, or adapter implementations and confines deprecated Pi facades to explicit compatibility forwarding. |

## Validation results

Focused Codex matrix command included all nine `test/codex-native-*.test.mjs` files plus the shared registry contract and import-boundary suite:

- 76 tests;
- 76 passed;
- 0 failed.

Dedicated import-boundary run:

- 2 tests;
- 2 passed;
- 0 failed.

Final workspace verification:

- `npm run typecheck -- --pretty false` — passed;
- `npm run build` — passed;
- canonical full suite — 1,734/1,734 passed across 12 suites;
- `git diff --check` — passed.

## Pibo2 boundary

This checkpoint changes only reusable test-contract strictness and deterministic coverage; it does not change the production adapter/runtime path installed at checkpoint 9.11. The exact packaged Pibo2 candidate at commit `3a52d1acbbb01302f40534a42b664ba902e87f03` remains the product-runtime authority for the next integrated milestone. Its exact Codex `0.147.0`, profile/catalog/session/Context Build/debug/Designer, permissions, cleanup, and unchanged-global-state evidence is recorded in `codex-native-profile-registration-validation-2026-08-16.md`.

No mock result in this report replaces the exact Pibo2 scenarios already recorded for protocol, process, thread, turn, requests, models, resources, tools, subagents, and profile registration. The matrix provides fast deterministic regression coverage for those exact-protocol behaviors before the milestone-10 integrated public flows.

## Result

Tasks 9.12 and 9.13 are complete. Every requested malformed/crash/overload/approval/input/abort/missing/history surface has deterministic coverage, native Codex and the fake adapter pass a stricter shared happy-path contract, generic import boundaries pass, and the complete repository typecheck/build/full suite is green.
