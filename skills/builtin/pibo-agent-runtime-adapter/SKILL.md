---
name: pibo-agent-runtime-adapter
description: Design, assess, implement, review, or debug a Pibo Agent Runtime Adapter for any agent harness. Use this whenever work mentions adding or replacing a harness, runtime drivers or configured instances, native Codex or another app server, capability matrices, frozen runtime bindings, Agent Designer runtime support, portable Pibo tools or MCP delivery, selected skills and context, approvals, model and reasoning controls, native history, or partial-adapter limitations. This skill requires evidence for every capability and prevents invented support, Pi-shaped generic abstractions, native prompt replacement, and global harness configuration mutation.
---

# Pibo Agent Runtime Adapter

Build adapters around Pibo's runtime SPI, not around assumptions from Pi, Codex, or another harness. Preserve the harness's native model loop, base prompt, standard tools, and native session state. Pibo remains the product and orchestration layer.

## Non-negotiable rules

1. Use `PiboSession.id` as the product routing identity. Treat native thread/session ids as adapter-scoped binding data.
2. Separate the runtime driver, configured runtime instance, live adapter, and live runtime session. They are not interchangeable.
3. Declare only capabilities proven by an official protocol/schema, harness source, deterministic fixture, or exact-binary integration.
4. Treat unknown behavior as unsupported or pending evidence. Never mark it supported because a similar harness usually has it.
5. Preserve the harness's native prompt and native tools. Do not place Pibo's Pi base prompt over another harness. Add only explicit Pibo product contributions through documented harness channels.
6. Never mutate user-global harness configuration to start one Pibo Session. Use session/generation-scoped state.
7. Keep generic orchestration free of harness imports and literal adapter branches when capability dispatch is sufficient.
8. Make process, credential, generated-file, subscription, and tool-bridge cleanup adapter/session owned and idempotent.
9. Keep Pibo product history primary for new routed turns. Put native history parsing behind the adapter.
10. Make unsupported Designer selections visible with a reason and reject invalid saves/starts instead of silently dropping them.

## Start with evidence

Before proposing code:

1. Read `GLOSSARY.md` and repository instructions.
2. Inspect the current SPI in `src/agent-runtime/`; do not rely on an older architecture document alone.
3. Identify the exact harness executable, SDK, protocol version, generated schema, and official documentation available in the target environment.
4. Record each candidate capability with its evidence and confidence.
5. Classify the adapter as full, partial, or not currently viable.

Use this evidence table:

| Pibo capability | Harness surface | Evidence | Classification | Gap or constraint |
|---|---|---|---|---|
| Text turns | method/event names | official schema or source | native / degraded / unsupported / pending | concrete limitation |

A capability is not proven by a product announcement, terminal screenshot, or undocumented output that merely resembles a protocol.

## Choose the task path

### Assess or review a harness

Produce:

1. exact harness/version evidence;
2. a complete Pibo capability matrix;
3. native prompt/tool/session preservation analysis;
4. full versus partial classification;
5. unsupported and pending-evidence items with Designer behavior;
6. security and isolation risks;
7. implementation, test, migration, and exact Pibo2 validation plan.

Do not write implementation code until the evidence matrix is coherent.

### Implement an adapter

Proceed in this order:

1. Add protocol fixtures/client code inside `src/agent-runtimes/<adapter>/`.
2. Define a typed driver descriptor and parse operator config.
3. Create configured adapter instances through the plugin registry.
4. Implement one adapter-owned live session with prompt, events, abort, status, binding, and disposal.
5. Declare the smallest truthful capability set and implement every method implied by it.
6. Map profiles and Agent Designer selections through capability validation.
7. Deliver Pibo tools/resources through the existing session services instead of rebuilding them in the adapter.
8. Add native history only through `inspectHistory()` and `readHistory()`.
9. Run the fake/shared contract suite, adapter fixtures, migration tests, full suite, package checks, and exact-candidate Pibo2 scenarios.
10. Document remaining limitations; do not upgrade a capability claim until its end-to-end proof exists.

## Read references progressively

Load only the references needed for the current step:

- [Interfaces and registration](references/interfaces-and-registration.md) — descriptor, driver, configured instance, adapter, live session, plugin registration, diagnostics, source boundaries, extension points.
- [Capabilities and Agent Designer](references/capabilities-and-designer.md) — complete capability tree, method implications, delivery classifications, profile validation, full/partial behavior.
- [Lifecycle, bindings, and events](references/lifecycle-bindings-and-events.md) — lazy binding, resume, missing/error states, CAS, event normalization, approvals, user input, abort, disposal.
- [Portable delivery and native behavior](references/portable-delivery-and-native-behavior.md) — native prompt/tool preservation, Pibo tools, scoped MCP, external MCP, skills, context, subagents, models/auth/reasoning.
- [History, debug, and security](references/history-debug-and-security.md) — product history, native providers, payloads, runtime-aware debug, redaction, credential/process/file isolation.
- [Testing, migration, and Pibo2 validation](references/testing-migration-and-validation.md) — contract tests, full/partial fixtures, import boundaries, migrations, package checks, exact-server validation, evidence reports.

## Capability truth rules

Use these classifications consistently:

- **Native** — the harness exposes the behavior directly through a documented API/protocol.
- **Direct** — Pibo can deliver its own capability in-process without changing native harness behavior.
- **MCP** — the harness accepts Pibo's session-scoped MCP bridge over a declared transport.
- **Materialized** — Pibo can provide isolated generated files/config through a documented harness surface.
- **Degraded** — a real supported path exists but fidelity is lower; declare mode and reason.
- **Unsupported** — no safe supported path exists; declare a user-facing reason.
- **Pending evidence** — do not put this in runtime capabilities as support. Keep it in design/evidence notes until proven.

A partial adapter is valid. A dishonest full adapter is not.

## Minimal implementation shape

```text
Pibo plugin
  -> registerAgentRuntimeDriver(driver)
  -> registerAgentRuntimeInstance(definition)

AgentRuntimeDriver
  -> descriptor + config schema
  -> defaultConfig / parseConfig / create

AgentRuntimeAdapter (configured instance)
  -> diagnose / validateProfile / openSession
  -> optional models, profile inspection, history, binding resolution
  -> capability-backed auth status/start/complete/cancel/logout

AgentRuntimeSession (one live Pibo Session)
  -> getBinding / subscribe / prompt / abort / dispose / getStatus
  -> optional steer and capability-gated controls
```

Do not let the configured adapter hold mutable state that belongs to one live session unless it is keyed, isolated, and disposed by session generation. Provider-login flow state is configured-instance state: keep native ids/verifiers adapter-private, expose only Pibo flow ids, bound it by timeout, and close owned processes on every terminal path.

## Partial-adapter decision pattern

When the harness lacks a feature:

1. cite the missing or insufficient official surface;
2. set the corresponding capability to `false` or `unsupportedAgentRuntimeCapability(reason)`;
3. omit the control method that would falsely imply support;
4. let profile validation reject selected unsupported resources;
5. keep the Designer control visible but disabled with the same reason;
6. test the negative path;
7. name the evidence that could justify enabling it later.

Do not scrape terminal output, inject Pi's prompt, expose global MCP config, or synthesize fake native history merely to make a capability appear available.

## Review checklist

### Architecture

- [ ] Adapter id and configured instance id are stable and distinct.
- [ ] Config uses a JSON Schema and typed parser.
- [ ] Generic modules do not import harness packages.
- [ ] Availability/version diagnostics are safe and actionable.

### Session and binding

- [ ] `PiboSession.id` remains the product id.
- [ ] Initial `unbound` and persistent `bound` behavior is explicit.
- [ ] Missing native state becomes `missing`, not a replacement conversation.
- [ ] Binding changes use revisions/CAS and repair/rebind rules.
- [ ] Abort and dispose are bounded and idempotent.

### Events and controls

- [ ] Native events map to Pibo semantic events with stable correlation ids.
- [ ] Every advertised optional control has an implementation.
- [ ] Approvals and structured input preserve request identity.
- [ ] Errors are normalized and secrets are removed.

### Portable capabilities

- [ ] Native prompt and tools remain intact.
- [ ] Pibo-managed tools use direct delivery or session-scoped MCP.
- [ ] External MCP, skills, and context are selected-only and generation-scoped.
- [ ] Secret values remain in scoped environment/process state, not generated files or inspection.
- [ ] Pibo subagents route through child Pibo Sessions and may select another runtime.

### Product surfaces

- [ ] Agent Designer shows truthful support, modes, diagnostics, and disabled reasons.
- [ ] Model/auth/reasoning/options come from the selected runtime instance.
- [ ] Auth capabilities name methods, completion mode, cancellation/logout, and credential scope.
- [ ] Product auth mutations require an explicit configured-runtime target; session compatibility uses the frozen binding.
- [ ] Missing required auth status is unauthenticated/failed, never implicitly connected.
- [ ] Public auth results use opaque Pibo flow ids and omit native login ids, separate OAuth state/verifier fields, tokens, API keys, account identifiers, and credential paths/content; ephemeral authorization URLs/codes are never captured as evidence.
- [ ] Product history, trace, debug, telemetry, Cron, Loop, workflow, and TUI behavior are assessed.

### Verification

- [ ] Shared adapter contract and deterministic protocol fixtures pass.
- [ ] Unsupported capability selections fail in tests.
- [ ] Existing data migrates without id/native-state rewriting.
- [ ] Package contents include adapter assets and skills.
- [ ] Exact candidate passes authenticated Pibo2 restart/resume, failure, cleanup, API, debug, and browser checks.
- [ ] Evidence report records commit, version, timings, limitations, and cleanup.
