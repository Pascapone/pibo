# Spec: Multi-Agent Runtime Adapters

**Status:** Implementing
**Created:** 2026-08-14
**Requester / Source:** Active Pibo Loop goal
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `GLOSSARY.md`, `docs/specs/capabilities/pibo-session-routing.md`, `docs/specs/capabilities/pibo-runtime-assembly-and-inspection.md`, `docs/specs/capabilities/custom-agents.md`, `docs/specs/capabilities/pibo-event-contract.md`, `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`

## Why

Pibo is the product and orchestration layer, but its current runtime boundary assumes every Pibo Session is backed by Pi Coding Agent. The assumption appears in runtime creation, `RoutedSession`, profiles, plugin tools, model/auth services, persistence, trace reconstruction, debug tooling, and Agent Designer. A second harness cannot be integrated honestly while those product paths depend on Pi-native types and behavior.

The change must first preserve Pi exactly behind a real adapter boundary. Only after Pi parity is proven may Pibo add native Codex through the official Codex App Server. A type-only seam or one successful Codex prompt is not sufficient.

## Goal

Pibo MUST provide a production-quality, capability-driven Agent Runtime Adapter architecture with a fully compatible `pi` adapter and a native `codex` adapter, while keeping Pibo Session identity and product orchestration authoritative and preserving each harness's native prompt, tools, session, transcript, and behavior.

## Scope

### In Scope

- Runtime driver descriptors, configured runtime instances, adapter registry, live runtime sessions, lifecycle isolation, diagnostics, and capabilities.
- Generic routed queueing, correlation, actions, status, abort, disposal, and normalized output distribution.
- Full Pi extraction and parity, including Pi runtime assembly, tools, packages, context, skills, model/auth, fast mode, compaction, recovery, TUI, history, and native session operations.
- Runtime session binding persistence and compatibility migration.
- Runtime-aware profiles, Agent Designer, context inspection, model/options selection, and capability validation.
- Pibo-owned portable tool contract, Pi compiler, secure session-scoped MCP bridge, skills/context/MCP materialization, and cross-runtime Pibo subagents.
- Runtime-neutral product history/trace input plus Pi and Codex history providers.
- Runtime-aware debug, telemetry, signal, reliability, Cron, Loop, workflow, and Chat Web behavior.
- Built-in runtime-adapter authoring skill and realistic eval coverage.
- Native Codex App Server integration, `codex-native` profile, and real Pibo2 validation.
- Focused branches, commits, PRs to `upstream/dev`, and durable validation evidence.

### Out of Scope

- Native Kimi Code, Oh My Pi, Prime Agent, or generic ACP adapters in this goal.
- Replacing Pibo orchestration with a harness-native workflow, goal, scheduler, or subagent system.
- Reinterpreting persisted/custom Pi-backed `codex` references or migrating existing sessions between harnesses automatically.
- Publishing npm packages, production deployment, release, or merge without separate approval.
- Wrapping private harness-native tools in Pibo yielded-run control unless an adapter explicitly advertises and proves that capability.

## Requirements

### REQ-001: Pibo remains the product authority

Pibo MUST remain authoritative for Pibo Sessions, rooms, projects, profiles, Agent Designer, workflows, Cron, Loops, goals, Pibo-managed subagents, signals, reliability, debug surfaces, Chat Web, and product data.

#### Acceptance

- Product APIs and routing use `PiboSession.id`, never a native harness id.
- Cross-runtime parent/child relationships use Pibo `parentId` and `originId`.
- Harness-native schedulers, goals, and subagents do not silently replace Pibo-owned equivalents.

#### Scenario: Cross-runtime child

- GIVEN a Pi parent profile selects a Pibo-managed subagent whose target profile uses Codex
- WHEN the parent invokes that subagent
- THEN Pibo creates or reuses a child Pibo Session
- AND the child has an independent Codex binding
- AND the reply returns through the existing normalized subagent result.

### REQ-002: Runtime drivers and configured instances are registered explicitly

Each harness integration MUST expose a stable adapter descriptor and one or more configured runtime instances through a Pibo-owned registry.

#### Acceptance

- A descriptor includes adapter id, display name, transport, config schema, declared capabilities, and availability/version diagnostics.
- A configured instance has a stable instance id, adapter id, validated config, enabled state, and diagnostics.
- The registry rejects duplicate adapter ids and duplicate configured instance ids.
- Configured instances are distinct from live runtime-session handles.
- Generic orchestration resolves by configured instance id and does not hard-code `pi` or `codex` when a capability dispatch is sufficient.

#### Scenario: Two configured instances

- GIVEN two configured instances of one adapter have different isolated homes
- WHEN sessions open through each instance
- THEN process state, configuration, credentials, and cleanup remain isolated.

### REQ-003: Live runtime sessions have a generic lifecycle

A live adapter session MUST support start/bind/resume, prompt, streaming subscription, abort, disposal, status, and capability-gated controls through a generic Pibo interface.

#### Acceptance

- `openSession` receives the Pibo Session, frozen runtime selection, binding, workspace, profile, active model, and router-owned portable-tool and runtime-resource sessions sharing one live generation id.
- The returned session exposes its current binding and status.
- Prompt completion means the adapter's native turn and required adapter recovery have settled.
- Abort and disposal are idempotent and bounded by router cleanup policy.
- Adapter-owned processes and listeners are released even after start failure, crash, or forced disposal.
- A session from one adapter cannot mutate another adapter's process or session state.

#### Scenario: Start failure cleanup

- GIVEN an external adapter launches a process and initialization fails
- WHEN `openSession` rejects
- THEN the child process, subscriptions, temporary home, and credentials are released.

### REQ-004: Capabilities are explicit and enforced

Adapters MUST declare required and optional capabilities for session lifecycle, input/output, tools, MCP, skills, context, models, reasoning, approvals, compaction, history, native fork/tree operations, and other optional behavior.

#### Acceptance

- Capability descriptors distinguish unsupported, native, direct-compiled, MCP-bridged, materialized, and degraded delivery where applicable.
- Optional controls are invoked only when advertised and implemented.
- Unsupported saved selections are rejected before runtime start unless the profile explicitly opts into a documented degradation.
- Agent Designer keeps unavailable controls visible but disabled with an explanation.
- Inspection reports effective capabilities and delivery modes.
- Pibo does not infer support from adapter identity.

#### Scenario: Unsupported native fork

- GIVEN an adapter does not advertise native fork
- WHEN a client requests the native fork action
- THEN Pibo returns a capability-unavailable diagnostic
- AND does not emulate a fork silently.

### REQ-005: Runtime events are normalized before product distribution

Adapters MUST map native events into Pibo-owned runtime semantic events, and generic routing MUST map those events into the existing product output contract.

#### Acceptance

- Semantic events cover assistant text, reasoning, tool call lifecycle, usage, compaction, turn completion/failure, approvals, user-input requests, warnings, and adapter lifecycle where supported.
- Product event correlation uses the active Pibo input event id.
- Raw native events are opt-in, namespaced by adapter, redacted where needed, and never required for normal Chat Web rendering.
- Deprecated `pi_event` forwarding remains available for Pi compatibility during the documented period.
- Unknown native events do not crash the session and are observable through bounded diagnostics when raw capture is enabled.

#### Scenario: Codex reasoning stream

- GIVEN Codex emits reasoning-summary deltas and a final agent message
- WHEN the adapter normalizes the turn
- THEN Chat Web receives Pibo reasoning and assistant events correlated to the submitted Pibo message.

### REQ-006: The Pi adapter preserves exact current behavior

All Pi-specific runtime concerns MUST move behind the `pi` adapter before native Codex implementation begins, without changing current public behavior or persisted identifiers.

#### Acceptance

- `pi` is the default adapter and default configured instance.
- Existing `createPiboRuntime`, `inspectPiboProfile`, direct TUI, routed TUI, gateway actions, event variants, and Pi session-operation APIs remain compatible through documented facades.
- Existing Pi sessions reopen with the same Pi session id and transcript path.
- Pi model/auth registry, tools, built-in tool policy, packages, skills, context, provider extensions, fast mode, compaction, context guard, provider recovery, transcript integrity, history, fork/clone/tree/switch, and TUI behavior remain operational.
- Generic router modules do not import Pi packages after extraction.
- The full existing suite, builds, fake adapter contract, Pi adapter contract, old-session reopen fixtures, and authenticated Pibo2 parity scenarios pass before Codex feature work starts.

#### Scenario: Reopen old Pi session

- GIVEN a pre-migration Pibo Session points at an existing Pi JSONL transcript
- WHEN the migrated gateway opens it through the `pi` adapter
- THEN the same Pi id and transcript file are used
- AND no transcript or Pibo Session id is rewritten.

### REQ-007: Runtime bindings are additive and backward compatible

Pibo MUST persist an opaque runtime session binding separately from product routing identity.

#### Acceptance

- A binding stores Pibo Session id, configured runtime instance id, adapter id, optional native session id, state, protocol/version metadata, optional locator, metadata, timestamps, and a revision or compare-and-set guard.
- Binding states include at least `unbound`, `bound`, `missing`, and `error`.
- Native session uniqueness is scoped to `(adapter id, native session id)` so one native conversation cannot be attached through two configured instances of the same harness.
- Existing sessions are backfilled as bound `pi` sessions using their current `piSessionId`.
- Deprecated `piSessionId` fields remain available and dual-read/dual-write for at least two minor releases; removal is out of scope for this goal.
- New non-Pi sessions may have no Pi id and begin unbound.
- A missing native session becomes a visible `missing` diagnostic and is not replaced automatically.

#### Scenario: Missing Codex thread

- GIVEN a Pibo Session is bound to a Codex thread that no longer exists
- WHEN the gateway resumes the session
- THEN the binding becomes `missing`
- AND the user receives a diagnostic and explicit recovery choices
- AND Pibo does not create a replacement thread under the same conversation silently.

### REQ-008: Runtime selection is frozen per Pibo Session

Profiles MUST define a default configured runtime instance, and each new Pibo Session MUST freeze the selected instance independently of later profile edits.

#### Acceptance

- Existing profiles and custom agents default to configured instance `pi`.
- Session creation may explicitly select a valid configured instance or inherit the profile default.
- The selected configured instance is persisted before runtime work begins.
- Editing a profile's runtime default affects future sessions only.
- Existing sessions do not migrate to another harness without an explicit attach/migration action.

#### Scenario: Custom agent default changes

- GIVEN a custom agent originally defaults to Pi and has existing Pi sessions
- WHEN its default is changed to `codex-native`
- THEN new sessions use Codex
- AND existing sessions continue using their stored Pi bindings.

### REQ-009: Agent Designer is a cross-runtime control plane

Agent Designer MUST expose runtime selection, diagnostics, adapter-native options, and portable Pibo capabilities for every adapter.

#### Acceptance

- The catalog includes adapters, configured instances, availability/version, config/options schema, declared capabilities, and effective portable delivery modes.
- Saved selections cover Pibo tools, external MCP servers, built-in/plugin/user skills, managed/plugin context files, Pibo subagents, models, reasoning, run control, goal control, and adapter-native options.
- Invalid combinations are rejected on save with specific diagnostics.
- Genuine upstream limitations remain visible as disabled controls with explanations.
- Context Build shows each selected contribution, delivery channel, fidelity, connection/materialization result, and skipped/unsupported reason.

#### Scenario: Unsupported Codex option

- GIVEN Codex cannot deliver one selected capability through any official supported mechanism
- WHEN a user edits the agent
- THEN the control remains visible but disabled for Codex with evidence-backed text
- AND an invalid persisted selection is rejected rather than ignored.

### REQ-010: Native harness prompts and tools are preserved

An adapter MUST preserve its harness's native base prompt and standard native tools unless the user explicitly selects a supported native override.

#### Acceptance

- Pibo's Pi base system prompt remains Pi-adapter behavior.
- Codex does not receive the Pi base system prompt or Pi Codex-compatibility prompt.
- Pibo product context is injected only through official adapter-supported channels such as developer instructions, project instructions, skills, or MCP.
- The adapter reports the delivery mode and fidelity of each context contribution.
- Pibo does not mutate the user's global harness configuration to start a session.

#### Scenario: Native Codex startup

- GIVEN a `codex-native` session selects one Pibo context file
- WHEN the adapter starts Codex
- THEN Codex retains its native system prompt and standard tools
- AND only the selected Pibo context contribution is injected through an inspectable official channel.

### REQ-011: Pibo tools use a portable contract and secure delivery

Pibo-owned tools MUST use a JSON-Schema-based contract and result model independent of Pi.

#### Acceptance

- The contract supports text/image content, structured data, progress/update, cancellation, errors, correlation, annotations, and large-result references.
- Pi compiles the contract to direct in-process Pi tool definitions without behavior regression.
- External harnesses receive selected Pibo tools through a session-scoped MCP bridge unless an adapter advertises another proven direct mechanism.
- Credentials are random, short-lived, stored only as hashes where persisted, bound to one Pibo Session, configured runtime instance, adapter session generation, and selected tool set, and revoked on disposal/rebind.
- Cross-session discovery and invocation are denied and tested.
- `pibo_run_start` wraps Pibo-managed tools only unless the adapter explicitly advertises native-tool wrapping.

#### Scenario: Cross-session denial

- GIVEN session A and session B have different MCP credentials and tool selections
- WHEN session A's credential requests a tool selected only for session B
- THEN the bridge returns an authorization error
- AND no tool execution begins.

### REQ-012: Skills, context, and external MCP are isolated and verified

Selected skills, context files, and external MCP servers MUST be delivered through adapter-supported isolated mechanisms.

#### Acceptance

- `SKILL.md` remains Pibo's canonical skill format.
- Selected built-in, plugin, and user skills are materialized into an adapter/session-generation-specific directory or passed through an official native API.
- Unselected skills are absent from adapter-visible roots; escaping symlinks, cycles, and configured file/byte limits fail safely.
- Context contributions are ordered and carry source, kind, intent, requiredness, byte size, delivery mode, target, and fidelity.
- Required contributions that cannot be delivered fail validation/start unless an explicit degradation is saved; non-strict inspection still exposes the failure.
- External MCP definitions are selected-only and scoped to the session/adapter generation. Resolved secret values remain in adapter-scoped environment state and are absent from generated files and inspection.
- External MCP delivery is verified by a bounded protocol connection and safe tool/resource/template inventory, not by config-file existence alone.
- The source MCP configuration, process-global environment, user-global Codex/Pi configuration, bindings, and unrelated runtime generations are not modified merely to start a Pibo Session.
- Disposing or replacing the runtime session removes generated state and invalidates its scoped environment/config view.

#### Scenario: Skill isolation

- GIVEN a profile selects skill A but not skill B
- WHEN an external runtime starts
- THEN only skill A exists in its isolated skill roots
- AND inspection proves skill B is absent.

### REQ-013: Product history and debug are runtime neutral

Normal Chat Web history for new Pibo-routed turns MUST be reconstructable from normalized Pibo data without locating native transcript files.

#### Acceptance

- Generic trace code consumes Pibo-owned history entries and product events.
- Pi transcript parsing moves behind the Pi history provider.
- Codex history uses official thread read/list APIs or adapter-owned imports.
- Old Pi sessions continue rendering through the Pi history compatibility path.
- Missing native transcripts do not remove Pibo Session records or normalized product history.
- Debug session, events, failures, tools, signals, telemetry, trace, and binding diagnostics work for all adapters and redact credentials.
- Runtime-specific drill-down is namespaced and bounded.

#### Scenario: New Codex trace after restart

- GIVEN a Codex turn completed through Pibo and the gateway restarts
- WHEN Chat Web reloads the session
- THEN the terminal reconstructs the product-visible turn from Pibo data
- AND Codex native history remains available for resume/debug without becoming the normal UI dependency.

### REQ-014: The adapter-authoring skill is built in and tested

Pibo MUST ship a built-in `pibo-agent-runtime-adapter` skill that teaches correct full and partial adapter implementation.

#### Acceptance

- The skill covers interfaces, registration, capabilities, lifecycle, binding, events/errors, Designer mapping, Pibo tool delivery, external MCP, skills/context, native behavior preservation, models/auth/reasoning/approvals, history/debug, security, tests, migration, Pibo2 validation, and extension points.
- The skill uses progressive references and a concise checklist.
- Tests/evals show an agent can assess and scaffold both a fully capable and an explicitly partial harness without inventing support.
- The skill is registered in the built-in catalog and package output.

### REQ-015: Native Codex uses the official App Server

The `codex` adapter MUST use the official Codex App Server v2 protocol over a supported transport and generated schema matching the validated binary.

#### Acceptance

- No terminal-output scraping is used for turns or events.
- The adapter performs initialize/initialized handshake and reports process/version/availability diagnostics.
- It owns process lifecycle and cleanup, creates or resumes persistent threads, starts turns, streams assistant/reasoning/tool/usage events, interrupts turns, and reads native history.
- It integrates command/file approvals, structured user-input requests, native model/reasoning options, context usage, and failures where supported.
- It preserves native Codex standard tools.
- It passes selected Pibo tools through the session-scoped MCP bridge; selected external MCP, skills, and context are delivered and verified through supported mechanisms.
- Fresh and resumed threads survive Pibo gateway restart.
- The adapter pins a supported version range and stores generated protocol fixtures for the exact validated binary.
- Unsupported official surfaces are declared unsupported with evidence; undocumented terminal hacks are forbidden.

#### Scenario: Resume across service restart

- GIVEN a `codex-native` Pibo Session completed a turn and stored its thread binding
- WHEN `pibo-web.service` restarts
- THEN the adapter resumes the same Codex thread id
- AND a new turn continues the prior conversation.

### REQ-016: Existing Codex compatibility meaning is stable

Persisted or custom `codex-compat-openai-web` profiles and `codex` aliases MUST retain their Pi-backed meaning. The clean `upstream/dev` baseline at `54176105` on August 14, 2026 intentionally exposes no default built-in `codex` profile, so native Codex MUST NOT claim that retired alias implicitly.

#### Acceptance

- The default registry continues to reject `registry.createProfile("codex")` unless a plugin/custom-agent definition explicitly supplies that alias.
- Any persisted or explicitly registered `codex` alias continues to select configured instance `pi`.
- Native Codex is exposed only through a distinct profile such as `codex-native`.
- No existing session or saved profile is silently reinterpreted as native Codex.

### REQ-017: Contract, architectural, migration, and integrated tests prove the system

Verification MUST match the breadth of the runtime change.

#### Acceptance

- A deterministic fake adapter and reusable contract suite cover lifecycle, prompt/events, abort, disposal, missing session, crash, malformed event, and every advertised optional capability.
- Pi and Codex run the same applicable adapter contract suite.
- Import-boundary tests prevent Pi/Codex dependencies in generic agent-runtime/router/history modules.
- Database migration tests cover old data, backfill, uniqueness, unbound/bound/missing transitions, dual read/write, and rollback.
- Full existing tests, typechecks, builds, and compatibility tests pass after Pi extraction.
- Exact candidate binaries pass authenticated Pibo2 scenarios for Pi and Codex, including restart/resume, tools, skills, context, MCP, subagents, loops, debug/trace, approvals/user input where available, abort/failure, disabled-capability explanations, rendering, streaming, and performance.
- Evidence is recorded under `docs/reports/` with commit/version/timestamps and remaining uncertainty.

### REQ-018: Delivery remains reviewable and progressively discoverable

Implementation MUST be split into focused or explicitly stacked branches/PRs to `upstream/dev`, with synchronized docs and no unrelated dirty-checkout changes.

#### Acceptance

- Every PR contains only a reviewable milestone and names dependencies.
- Validated milestones are committed; broken states are not committed.
- Runtime CLI discovery is compact and points to deeper `show`, `schema`, `doctor`, or `guide` commands.
- No production deployment, release, package publication, or merge occurs solely because tests pass.
- A final audit maps every requirement to code, tests, PRs, and Pibo2 evidence.

## Edge Cases

- A profile points to a configured runtime instance that is disabled or unavailable.
- Two gateways race to bind one unbound Pibo Session.
- A native session exists but its locator moved.
- An adapter process exits while a tool or approval is active.
- A capability is advertised but its method is missing, or a method exists without the capability.
- A selected MCP server starts but exposes fewer tools than inspection expected.
- A selected MCP definition references a missing secret, contains a sensitive literal argument, or cannot complete protocol initialization before the bounded timeout.
- A selected skill contains an escaping symlink, symlink cycle, too many files, or too many bytes.
- Context Build needs to explain a failed required contribution without making the unavailable runtime session start successfully.
- A credential expires during a long turn; active-session liveness can renew it without broadening scope.
- A Pi or Codex native transcript is malformed or missing while normalized Pibo history still exists.
- A runtime emits duplicate, late, or out-of-order terminal events after abort/disposal.
- A profile selects a Pibo-managed yielded tool and a private harness-native tool with the same display name.

## Constraints

- **Compatibility:** Pi behavior and ids are the parity baseline. Compatibility fields remain additive during this goal.
- **Security:** No raw auth tokens, cookies, machine keys, or MCP credentials appear in bindings, logs, debug output, traces, screenshots, or reports.
- **Isolation:** External adapters use per-instance/per-session homes or official scoped configuration. One session's cleanup cannot terminate another session's process.
- **Performance:** Pi parity requires no material regression in startup, first-delta, streaming, trace loading, or browser rendering on Pibo2.
- **Protocol:** Codex integration uses stable v2 methods generated from and tested against the installed binary. Experimental methods require explicit capability flags and may not be claimed as stable.
- **Git:** Work starts from current `upstream/dev` in clean worktrees and excludes the dirty `/root/code/pibo` checkout.

## Success Criteria

- [x] SC-001: Runtime SPI and registry are independent of Pi and Codex and pass fake adapter contracts.
- [ ] SC-002: Pi runs entirely through the adapter boundary with full local and Pibo2 parity.
- [x] SC-003: Runtime bindings migrate existing data without id or transcript rewrite.
- [x] SC-004: Agent Designer and profile inspection are runtime-aware and reject unsupported selections.
- [ ] SC-005: Pibo tools, MCP, skills, context, and Pibo subagents have proven cross-runtime delivery and isolation.
- [ ] SC-006: New product history, trace, debug, telemetry, and binding inspection are runtime neutral.
- [ ] SC-007: The built-in adapter-authoring skill is registered and passes full/partial-adapter evals.
- [ ] SC-008: Native Codex passes real Pibo2 restart/resume, tool, context, skill, MCP, subagent, approval/user-input, abort/failure, trace, and Designer scenarios.
- [ ] SC-009: Existing `codex` compatibility semantics remain unchanged.
- [ ] SC-010: Full tests, typechecks, builds, migrations, candidate validation, docs, PRs, and final requirement audit are complete with no known invalidating regression.

## Assumptions and Open Questions

### Decisions / Assumptions

- Profiles store a default configured runtime instance; a new session freezes it. Explicit session create APIs may override it only with a registered compatible instance.
- Binding uniqueness is scoped to adapter id plus native session id, including across configured instances of the same adapter.
- Loopback Streamable HTTP MCP is the first external-harness bridge because official Codex supports URL plus bearer-token environment configuration. Stdio can be added later if another adapter requires it.
- Required context does not fall back to a visible bootstrap message unless the saved profile explicitly permits that degradation.
- Pibo-managed subagents are mandatory portable behavior. Harness-native subagents remain adapter-native and separately described.
- Runtime binaries are discovered from configured paths or `PATH`; automatic binary installation is out of scope.
- Deprecated `piSessionId` API/store fields remain for at least two minor releases and are not removed in this goal.

### Open Questions

- Which Codex App Server methods should be treated as stable versus experimental after testing the exact Pibo2 binary?
- Should explicit attach-to-existing-native-session be exposed in the first Chat Web UI or only through a guarded CLI/API initially?
- Which approval policy should `codex-native` use by default in Chat Web after integrated UX validation?

## Traceability

| Requirement | Primary phase | Verification | Status |
|---|---|---|---|
| REQ-001 Product authority | All | Cross-runtime subagent/workflow/loop scenarios | Pending |
| REQ-002 Registry | Foundation | Registry unit tests, catalog tests | Pi + Designer local pass |
| REQ-003 Session lifecycle | Foundation/Pi/Codex | Shared adapter contract | Pi local pass; Codex pending |
| REQ-004 Capabilities | Foundation/Designer | Capability consistency and save-validation tests | Designer local pass |
| REQ-005 Events | Pi/Codex/History | Event fixtures and trace tests | Pending |
| REQ-006 Pi parity | Pi extraction | Full suite, old-session fixtures, Pibo2 parity | Pending |
| REQ-007 Bindings | Persistence | Migration/uniqueness/CAS/missing tests | Local + Pibo2 pass |
| REQ-008 Frozen runtime selection | Profiles/Persistence | Profile edit and existing-session tests | Local + Pibo2 pass |
| REQ-009 Agent Designer | Designer | API/UI save/disabled/inspection tests | Local + Pibo2 pass |
| REQ-010 Native behavior | Pi/Codex | Prompt/tool/context inspection | Pending |
| REQ-011 Portable tools | Tool bridge | Pi compiler/MCP/security tests | Local + exact-candidate Pibo2 pass; see `portable-pibo-tools-mcp-validation-2026-08-15.md` |
| REQ-012 Skills/context/MCP | Materialization | Isolation, secret rebinding, connected inventory, failure, cleanup, Context Build, and Pi-scoped CLI tests | Local pass; exact-candidate Pibo2 pending |
| REQ-013 History/debug | History | New-turn no-native-read, old Pi, Codex restart tests | Pending |
| REQ-014 Authoring skill | Skill | Registration plus full/partial evals | Pending |
| REQ-015 Native Codex | Codex | Fixtures, exact binary, Pibo2 integrated flows | Pending |
| REQ-016 Compatibility alias | Profiles | Existing profile tests | Local pass; native profile pending |
| REQ-017 Verification | All | Local and Pibo2 evidence reports | Pending |
| REQ-018 Delivery | All | Branch/commit/PR/final audit | Implementing |
