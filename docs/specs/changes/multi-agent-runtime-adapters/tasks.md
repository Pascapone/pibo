# Tasks: Multi-Agent Runtime Adapters

**Status:** Implementing
**Updated:** 2026-08-15

Each milestone must be committed only after its listed verification passes. Codex implementation may not begin while a known Pi parity regression remains.

## 0. Evidence and specification

- [x] 0.1 Read `GLOSSARY.md`, repository instructions, Git flow, spec-writing, and Pibo2 server-development skills.
- [x] 0.2 Inspect current `upstream/dev` and create clean worktree `feature/agent-runtime-foundation` at `54176105c2f0c752a3d6de017fbebb40e301e565`.
- [x] 0.3 Read the existing multi-agent runtime investigation from the dirty checkout without modifying that checkout.
- [x] 0.4 Inspect required T3 Code provider/adapter/registry/MCP references at commit `e25021af767b10c560862fcec714cf67fb22cfae`.
- [x] 0.5 Inspect official Codex App Server docs and generated protocol schemas at commit `a186f5484dc8b89f103859a7c9bd632881fba54b`.
- [x] 0.6 Write proposal, behavioral spec, design, and implementation plan.
- [x] 0.7 Copy the investigation report into the clean branch and link all durable docs.
- [x] 0.8 Update `GLOSSARY.md` with harness/runtime terms.
- [x] 0.9 Record baseline full-suite result for `upstream/dev` (1,598/1,598 passing at `54176105`).

## 1. Foundation PR: runtime SPI, registry, fake adapter, Pi facade

Target branch: `feature/agent-runtime-foundation`

- [x] 1.1 Add `src/agent-runtime/types.ts`, `capabilities.ts`, `events.ts`, `errors.ts`, and `registry.ts`.
- [x] 1.2 Define descriptor/configured-instance/live-session separation and capability consistency checks.
- [x] 1.3 Add additive runtime selection fields to `InitialSessionContext` with default configured instance `pi`.
- [x] 1.4 Extend plugin API/registry/capability catalog to register and inspect configured runtime instances.
- [x] 1.5 Add deterministic fake adapter and reusable contract harness under `src/agent-runtime/testing/`.
- [x] 1.6 Add `PiAgentRuntimeAdapter` that wraps existing runtime creation without behavior change.
- [x] 1.7 Make `PiboSessionRouter` resolve runtime through the registry instead of importing `createPiboRuntime` directly.
- [x] 1.8 Keep `createPiboRuntime`, `inspectPiboProfile`, and direct TUI compatibility exports.
- [x] 1.9 Add tests for duplicate registration, config validation, catalog output, default Pi selection, and fake/Pi contract basics.
- [x] 1.10 Verify focused tests, typecheck, build, and full suite (1,605/1,605 passing).
- [x] 1.11 Commit, push, and open focused PR #476 to `upstream/dev` with exact verification evidence.

## 2. Pi extraction PR: generic RoutedSession and full Pi parity

- [x] 2.1 Move Pi event normalization under `src/agent-runtimes/pi/` and leave only an explicit deprecated core facade.
- [x] 2.2 Move Pi prompt settlement, context-guard continuation, provider recovery, transcript-integrity continuation, and compaction continuation behavior into Pi session code.
- [x] 2.3 Move fast-mode provider patches and Pi context estimation/continuation into Pi session code.
- [x] 2.4 Move Pi model/thinking/status/context/provider-usage access into Pi controls/status implementation.
- [x] 2.5 Move Pi list/fork/clone/tree/navigate/switch operations into capability-gated Pi controls.
- [x] 2.6 Refactor generic `RuntimeRoutedSession` to queue inputs, correlate events, dispatch capabilities, and distribute normalized events only.
- [x] 2.7 Preserve deprecated raw `pi_event`, Pi operation result types, and test compatibility handles.
- [x] 2.8 Add import-boundary tests forbidding Pi/Codex dependencies in generic runtime/router/history modules.
- [x] 2.9 Run focused queue, steering, recovery, compaction, action, tool, subagent, trace, debug, and telemetry tests (99/99 focused parity set passing).
- [x] 2.10 Run full build/typecheck/test suite (1,609/1,609 passing).
- [ ] 2.11 Validate fresh/resumed old Pi sessions and main controls on Pibo2; record performance/streaming comparison.
- [x] 2.12 Commit, push, and open stacked Pi parity PR #477; model-dependent parity evidence remains gated by 2.11.

## 3. Runtime binding persistence PR

- [x] 3.1 Add `RuntimeSessionBinding` types and store interface.
- [x] 3.2 Add `session_runtime_bindings` to `pibo.sqlite` with indexes, revision, and state validation.
- [x] 3.3 Add equivalent compatibility support to the legacy session store while it remains writable.
- [x] 3.4 Backfill existing sessions as bound `pi` records without changing ids or transcript paths.
- [x] 3.5 Allow non-Pi `sessions.pi_session_id` to be null while preserving Pi uniqueness.
- [x] 3.6 Implement dual read/write and synthesized legacy Pi binding fallback.
- [x] 3.7 Implement CAS `unbound -> bound`, missing/error transitions, and explicit repair/rebind path.
- [x] 3.8 Update APIs/read models/session inspection/debug/Chat Web metadata with additive binding data.
- [x] 3.9 Add migration, uniqueness, concurrent-bind, missing-session, rollback, and old-database tests; post-fix full suite passes 1,622/1,622.
- [x] 3.10 Validate migration against existing Pibo2 data and record row/id/path, authenticated API/UI, restart, debug, signals, and rollback evidence in `docs/reports/runtime-binding-persistence-validation-2026-08-15.md`.
- [x] 3.11 Commit, push, and open stacked persistence PR #478.

## 4. Portable profiles and Agent Designer PR

- [x] 4.1 Persist custom-agent runtime instance and adapter options with Pi defaults.
- [x] 4.2 Freeze runtime selection on new sessions; prove profile edits do not move existing sessions.
- [x] 4.3 Add runtime descriptors/instances/diagnostics/effective capabilities to catalog and context build.
- [x] 4.4 Add Agent Designer runtime selector and schema-generated plus advanced JSON adapter options.
- [x] 4.5 Map portable capability selections to support/delivery diagnostics.
- [x] 4.6 Reject invalid saved selections and render disabled controls with reasons while allowing stale selections to be removed.
- [x] 4.7 Scope model/reasoning/auth catalogs by runtime instance.
- [x] 4.8 Keep plugin profiles read-only and preserve persisted/custom Pi-backed `codex` references without claiming the retired built-in alias.
- [x] 4.9 Add API/store/profile/UI/accessibility/autosave tests; local typecheck and full suite pass 1,632/1,632.
- [x] 4.10 Validate fresh Pi custom-agent create/edit/copy, invalid options, frozen binding, Context Build, existing custom-agent defaults, browser rendering, and cleanup on Pibo2; evidence is in `docs/reports/runtime-aware-agent-designer-validation-2026-08-15.md`.
- [x] 4.11 Commit, push, and open Designer/profile PR #479.

## 5. Portable Pibo tools and MCP bridge PR

- [x] 5.1 Define `PiboToolDefinition`, JSON Schema, result content, progress, cancellation, and large-result contracts.
- [x] 5.2 Add Pi compiler and migrate Pibo-owned generated/native tools through compatibility wrappers.
- [x] 5.3 Implement loopback Streamable HTTP MCP bridge using the official MCP SDK.
- [x] 5.4 Implement short-lived hashed capability credentials bound to session, runtime instance, generation, and selected tool names.
- [x] 5.5 Propagate cancellation, progress, text/image content, errors, correlation, and payload refs.
- [x] 5.6 Distinguish Pibo-managed yielded tools from private harness-native tools in capabilities and Designer.
- [x] 5.7 Add cross-session discovery/call denial, expiry, revocation, removed-tool, progress, image, cancellation, error, and large-result tests.
- [x] 5.8 Prove behavior parity for representative tools through Pi direct and MCP paths (final local typecheck and full suite 1,639/1,639).
- [x] 5.9 Validate the exact candidate on Pibo2 for scoped discovery/calls, cross-session denial, MCP-session hijack denial, progress, cancellation, durable payloads, revocation, shutdown, catalog inspection, Context Build, and browser rendering; record `docs/reports/portable-pibo-tools-mcp-validation-2026-08-15.md`.
- [x] 5.10 Commit, push, and open portable-tools PR #483.

## 6. Skills, context, and external MCP materialization PR

- [x] 6.1 Add ordered runtime context plan and delivery report types.
- [x] 6.2 Add private adapter/session/generation directories under Pibo Home, shared with the portable-tool generation lifecycle.
- [x] 6.3 Materialize only selected built-in/plugin/user skills with symlink-boundary and size protections.
- [x] 6.4 Compile selected context into native or materialized adapter channels without replacing native prompts.
- [x] 6.5 Compile selected external MCP servers with selected-only configuration and scoped secret indirection.
- [x] 6.6 Verify MCP connected status and exposed tool/resource/template inventory through the official SDK.
- [x] 6.7 Extend capability/profile inspection and Context Build with mode/fidelity/status/target/inventory/diagnostics.
- [x] 6.8 Test unselected-resource absence, missing secrets, escaping symlinks, required-delivery failure, Pi Bash/CLI environment isolation, shared router generation, no source/global mutation, and cleanup.
- [x] 6.9 Commit, push, and open stacked materialization PR #486.

## 7. Runtime-neutral history, trace, and debug PR

- [x] 7.1 Add Pibo-owned normalized history entry/page types.
- [x] 7.2 Persist terminal semantic data required for new-turn Chat Web history.
- [x] 7.3 Move Pi transcript parsing and locator discovery behind the Pi history provider.
- [x] 7.4 Change generic trace builders to consume normalized history/product events.
- [x] 7.5 Keep old Pi transcript rendering/import/repair behavior.
- [x] 7.6 Make debug session/events/failures/tools/signals/telemetry/trace binding-aware.
- [x] 7.7 Add namespaced runtime drill-down and redaction tests.
- [x] 7.8 Prove new Pi session trace rendering without native transcript reads in the normal path.
- [x] 7.9 Validate old/missing Pi transcripts, schema-v5 migration, product payload fidelity, runtime-history pagination/cursor rejection, debug/telemetry, restart, browser rendering, and cleanup on Pibo2; evidence is in `docs/reports/runtime-neutral-history-trace-debug-validation-2026-08-15.md`.
- [x] 7.10 Commit, push, and open stacked history/debug PR #487.

## 8. Built-in adapter-authoring skill PR

- [x] 8.1 Create `skills/builtin/pibo-agent-runtime-adapter/SKILL.md`.
- [x] 8.2 Add progressive references for interfaces, capabilities, lifecycle/bindings, events, portable delivery, Designer, security, history/debug, and validation.
- [x] 8.3 Register the skill in the core plugin and package output.
- [x] 8.4 Add concise implementation checklist and extension-point map.
- [x] 8.5 Add realistic Orion full-adapter and Relay explicitly partial-adapter eval fixtures with objective expectations.
- [x] 8.6 Add deterministic anti-invention tests and run full/partial GPT-5.6 Sol evals: with-skill outputs passed 20/20 assertions versus 9/20 without the skill; benchmark is `docs/reports/runtime-adapter-authoring-skill-eval-2026-08-15.json`.
- [x] 8.7 Commit, push, and open authoring-skill PR #488.

## 9. Native Codex adapter PR(s), only after Pi parity

- [x] 9.1 Pin official Pibo2 Codex App Server `0.147.0`, generate stable TypeScript/JSON Schema from that exact binary, store the full/v2 schemas and hashes, and record the `>=0.147.0 <0.148.0` checkpoint in `docs/reports/codex-app-server-protocol-checkpoint-2026-08-15.md`. Pi parity 2.11 remains blocked pending approved Pibo2-managed authentication.
- [ ] 9.2 Implement typed stdio JSON-RPC client with initialize/initialized, request correlation, backpressure handling, stderr diagnostics, and bounded shutdown.
- [ ] 9.3 Implement process/version/availability diagnostics and isolated per-instance/session home/config.
- [ ] 9.4 Implement thread start, binding CAS, resume, missing-thread state, read/list, and supported fork/history controls.
- [ ] 9.5 Implement turn start, steering if supported, streaming assistant/reasoning/item/tool/usage events, completion/failure, and interrupt.
- [ ] 9.6 Implement command/file approvals and structured user-input requests through normalized Pibo APIs/UI.
- [ ] 9.7 Implement native model/reasoning/service-tier/options catalog and context usage.
- [ ] 9.8 Deliver Pibo MCP tools, selected external MCP, selected skills, and selected context without Pi prompt injection.
- [ ] 9.9 Verify native Codex tools remain unchanged and inspectable.
- [ ] 9.10 Integrate Pibo-managed subagents and cross-runtime child sessions.
- [ ] 9.11 Add `codex-native`; assert it does not claim `codex` and that any explicitly registered/persisted `codex` alias remains Pi compatibility.
- [ ] 9.12 Add deterministic protocol fixtures, malformed/crash/overload/approval/input/abort/missing/history tests, and shared contract suite.
- [ ] 9.13 Run full suite/typecheck/build and import-boundary tests.
- [ ] 9.14 Commit, push, and open focused/stacked Codex PRs.

## 10. Exact Pibo2 integrated validation

- [ ] 10.1 Build and install the exact candidate(s) on disposable Pibo2.
- [ ] 10.2 Validate existing-data migration and rollback boundary.
- [ ] 10.3 Validate fresh/resumed Pi sessions, restart, tools, user skills, context, MCP, subagents, loops, trace/debug, TUI, Chat Web, and performance parity.
- [ ] 10.4 Validate fresh/resumed Codex threads across `pibo-web.service` restart.
- [ ] 10.5 Validate native Codex tools and Pibo MCP tools in one session.
- [ ] 10.6 Validate selected Codex skills, context files, and external MCP connectivity.
- [ ] 10.7 Validate Pibo-managed and cross-runtime subagents.
- [ ] 10.8 Validate approvals/user input when supported by the installed protocol.
- [ ] 10.9 Validate abort, process failure, missing thread, invalid selection, and disabled-capability explanations.
- [ ] 10.10 Capture authenticated browser screenshots/traces, API/debug evidence, telemetry, process state, and timings under `docs/reports/`.
- [ ] 10.11 Investigate and report any regression rather than weakening tests.

## 11. Documentation, PR synchronization, and final audit

- [ ] 11.1 Update canonical capability specs to implemented behavior.
- [ ] 11.2 Add architecture and call-flow docs under `docs/project/architecture/`.
- [ ] 11.3 Document migration, rollback, Pi adapter, Codex adapter, portable capabilities, security, and operator diagnostics.
- [ ] 11.4 Add progressively discoverable runtime CLI docs for implemented commands only.
- [ ] 11.5 Synchronize docs and evidence across stacked PRs.
- [ ] 11.6 Ensure every branch is clean, pushed, and represented by a reviewable PR to `upstream/dev`.
- [ ] 11.7 Produce final audit mapping REQ-001 through REQ-018 to code, tests, PRs, and Pibo2 evidence.
- [ ] 11.8 Confirm no known regression or material unreported uncertainty invalidates completion.
- [ ] 11.9 Mark the Pibo Loop goal complete only after the full audit passes.
