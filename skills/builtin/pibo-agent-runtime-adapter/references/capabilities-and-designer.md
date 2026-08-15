# Capabilities and Agent Designer

Use this reference to build the capability matrix, implement profile validation, or decide how a partial adapter appears in Agent Designer.

## Source of truth

Read:

- `src/agent-runtime/capabilities.ts`
- `src/agent-runtime/contract.ts`
- `src/agent-runtime/profile-validation.ts`
- `src/agent-runtime/context-build.ts`
- `src/apps/chat/agent-profiles.ts`
- `src/apps/chat/agent-store.ts`
- Agent Designer catalog/API/UI tests

Capabilities describe implemented behavior, not aspirations.

## Complete capability tree

### Lifecycle

| Field | Meaning | Evidence needed |
|---|---|---|
| `persistent` | Harness has durable native conversation state | Stable native id and reopen/read proof |
| `lazyBinding` | Pibo may start unbound and bind after native creation | Successful CAS transition during first open/turn |
| `resume` | Existing native state can continue | Exact-id restart/resume test |
| `attach` | Adapter can attach to pre-existing native state | Official attach/read API and validation |
| `listNativeSessions` | Native sessions can be enumerated | Bounded official listing API |
| `fork` | Native history can fork at an entry | Exact fork semantics and id mapping |
| `clone` | Current native leaf/session can be cloned | Official clone semantics |
| `tree` | Native branch tree can be inspected/navigated | Tree/read/navigation APIs |

`resume` and `attach` require `persistent:true`.

### Input

| Field | Meaning |
|---|---|
| `text` | Text prompts are accepted |
| `images` | Image inputs are supported through a real protocol field |
| `audio` | Audio inputs are supported |
| `steering` | Input can modify an active turn; requires `session.steer()` |
| `structuredOutput` | Harness supports a structured-output request/contract |

Do not infer image/audio support because the underlying model may support it. The harness protocol must carry it.

### Output

| Field | Meaning |
|---|---|
| `assistantDeltas` | Incremental assistant output events |
| `reasoning` | Native reasoning/thinking events |
| `toolEvents` | Native tool call/execution/result lifecycle |
| `usage` | Token/context/usage data |
| `plans` | Native plan updates |
| `diffs` | Native diff updates |
| `rawNativeEvents` | Bounded redacted native-event diagnostic path |

A final response does not prove delta support. A tool name in text does not prove tool lifecycle events.

### Delivery capabilities

`tools.piboManaged`, `tools.nativeToolYielding`, `mcp.externalServers`, `skills`, and `context` use `AgentRuntimeCapabilityDelivery`:

- `{ support: "native" }`
- `{ support: "direct" }`
- `{ support: "mcp", transports: ["streamable-http"] }`
- `{ support: "materialized", modes: ["..."] }`
- `{ support: "degraded", mode: "...", reason: "..." }`
- `{ support: "unsupported", reason: "..." }`

Use `unsupportedAgentRuntimeCapability(reason)` for consistent unsupported declarations.

`tools.piboManaged` describes Pibo-owned tools. `tools.nativeToolYielding` separately describes whether run control can wrap private harness-native tools. Never claim the latter merely because Pibo-managed tools work through MCP.

`mcp.statusInspection` means the adapter can report actual connection/inventory state, not merely that a config file was written.

### Models, reasoning, approvals, maintenance

| Field | Method/behavior implication |
|---|---|
| `models.catalog` | Adapter implements `listModels()` |
| `models.switchInSession` | Session controls implement `setModel()` |
| `models.optionsSchema` | JSON Schema for saved adapter-native profile options |
| `reasoning.supported` | Controls implement `getReasoning()` and `setReasoning()` |
| `reasoning.values` | Exact accepted values; no duplicates |
| `approvals.supported` | Controls implement `respondToApproval()` |
| `approvals.structuredUserInput` | Controls implement `respondToUserInput()` |
| `maintenance.compaction` | Controls implement `compact()` |
| `maintenance.contextUsage` | Status reports context usage |
| `maintenance.history` | Adapter implements both `inspectHistory()` and `readHistory()` |
| `maintenance.health` | Bounded health/availability diagnostics exist |

The registry and live-session contract reject several declaration/method mismatches. Tests must cover the rest.

## Evidence classification

For every field, record one of:

- **proven native** — official schema/source plus deterministic protocol test;
- **proven Pibo delivery** — existing Pibo direct/MCP/materialization service plus integrated adapter test;
- **degraded** — lower-fidelity but real path, with reason and user-visible consequences;
- **unsupported** — no safe surface;
- **pending evidence** — not yet a runtime capability claim.

Use exact method/event names and harness versions in the evidence notes. If a field depends on an experimental protocol, declare the supported version range and risk.

## Profile validation mapping

`validateAgentRuntimeProfileCapabilities()` already enforces core portable selections:

- selected Pibo tools, subagents, run control, or goal control require `tools.piboManaged`;
- MCP delivery for Pibo tools must include `streamable-http`;
- non-portable legacy tools are rejected for MCP adapters;
- private native-tool yielding remains a warning when only Pibo-managed yielding works;
- selected external MCP requires `mcp.externalServers`;
- selected skills require `skills` delivery;
- selected context or automatic context requires `context` delivery;
- automatic AGENTS.md/CLAUDE.md discovery requires materialized mode `native-project-discovery`;
- selected reasoning values require supported reasoning and accepted values.

Add adapter-specific validation for constraints not expressible in the generic matrix, such as incompatible option combinations, unsupported model modes, missing executable features, or protocol-version gates.

Run validation both when saving a custom agent and when starting a session. Save-time validation protects persisted intent; start-time validation catches runtime drift.

## Agent Designer behavior

For every capability group, provide:

- support state;
- delivery mode or native method;
- exact disabled reason when unsupported;
- diagnostics when unavailable/misconfigured;
- effective capability after profile selections;
- fidelity/status/target for selected delivered resources;
- model/auth/reasoning/options only from the selected configured instance.

Do not hide an existing selected value merely because the new runtime cannot deliver it. Show the stale/unsupported selection so the user can remove it, and reject saving it as an active valid configuration.

Profile defaults affect new sessions. Editing a profile's runtime instance must not rebind existing sessions.

## Full adapter example

A harness may be classified full when evidence proves:

- persistent native ids, resume, missing-state detection, and restart continuity;
- text plus required input types;
- assistant/reasoning/tool/usage events;
- abort and any claimed steering;
- native model/reasoning/options and auth diagnostics;
- approvals/user input when the protocol exposes them;
- native prompt and standard tools preserved;
- Pibo-managed tools delivered through direct or scoped MCP;
- selected external MCP, skills, and context delivered/verified;
- native history page provider;
- Agent Designer, trace/debug, jobs/loops/workflows/subagents, and Pibo2 proof.

"Full" means full against Pibo's required product outcome, not every optional boolean automatically set to true. Unsupported optional native tree operations may remain false if explicitly documented.

## Partial adapter example

For a harness with only one-shot text input and a final answer:

```ts
const capabilities = createMinimalAgentRuntimeCapabilities();
capabilities.output.assistantDeltas = false; // final assistant_message only
// Keep input.text, health, prompt, abort/dispose only where implemented.
// Leave persistence, resume, tools, MCP, skills, context, models,
// reasoning, approvals, compaction, and history off.
```

Then:

- start in `unbound` only if no durable native id exists;
- do not fabricate a native id to claim persistence;
- disable Designer model/reasoning/resource controls with reasons;
- reject profiles selecting Pibo tools/resources if delivery is unsupported;
- reconstruct new product history from Pibo events/messages only;
- document that restart starts a new harness invocation rather than resuming;
- test every negative selection and unsupported control.

A partial adapter can still be useful for bounded text turns. It must not pretend to be resumable or portable-capability complete.

## Common capability mistakes

- Advertising `reasoning` because assistant text contains a thought-like section.
- Advertising `history` by tailing logs without a stable native entry model.
- Advertising external MCP because the harness has a user-global MCP config file.
- Advertising skills because arbitrary prompt text can mention skill instructions.
- Advertising approvals because Pibo can block a tool independently of the harness's native approval flow.
- Advertising native tool yielding because Pibo can yield its own tools.
- Treating a configured model name as a model catalog.
- Treating process termination as a correct turn interrupt without protocol/process isolation evidence.
