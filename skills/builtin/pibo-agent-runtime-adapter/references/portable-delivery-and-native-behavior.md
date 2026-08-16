# Portable Delivery and Native Behavior

Use this reference when integrating Pibo-managed tools, external MCP, skills, context, subagents, models/auth/reasoning, or any harness configuration surface.

## Preserve the harness first

The harness owns:

- native model loop;
- base system prompt;
- standard tools and their semantics;
- native session/thread state;
- native compaction, approvals, and user-input behavior where available;
- protocol-specific resource discovery.

Pibo owns product context, profile selections, Pibo-managed tools, subagents, jobs/loops/workflows, routing, data, debug, and UI.

Do not place Pibo's Pi base prompt over another harness. Do not disable native tools just to make the harness resemble Pi. Do not rewrite global harness config to inject one Pibo Session's resources.

## Open-session services

`OpenAgentRuntimeSessionInput.services` may provide:

- `portableTools` — one Pibo-owned tool session for the live generation;
- `resources` — selected skills, ordered context, selected external MCP config, scoped environment, and delivery inspection;
- subagent/run/runtime controllers through Pibo's router;
- telemetry/compatibility services.

Consume these services; do not recreate their selection, credential, payload, filesystem, or cleanup logic inside the adapter.

The tool session and resource session share the same random runtime generation. Treat them as one disposable scope.

## Pibo-managed tools

Pibo tools use the harness-neutral `PiboToolDefinition` contract in `src/tools/contract.ts`:

- TypeBox/JSON-Schema input;
- optional structured output schema;
- text/image content;
- structured content and details;
- cancellation and progress;
- correlation metadata;
- durable payload references for large results.

### Direct delivery

Use `{ support: "direct" }` only when the adapter can compile/call Pibo definitions in-process without requiring harness-private context. Pi uses a direct compiler under `src/agent-runtimes/pi/tool-compiler.ts`.

Do not expose a legacy definition with `portable:false` outside its compatibility adapter.

### MCP delivery

Use MCP when the external harness supports an official MCP configuration or runtime API. The adapter obtains access from `services.portableTools.issueMcpAccess()`.

The returned URL/token are sensitive session-owned process state:

- keep the raw token only in memory or scoped process configuration;
- never persist it in runtime bindings or Pibo data;
- never print it in logs, diagnostics, Context Build, screenshots, or errors;
- pass only the selected allowlisted tool names;
- renew only within the existing scope;
- revoke on disposal;
- do not reuse an MCP transport session with another credential/session.

Pibo's bridge is loopback Streamable HTTP, validates schemas, propagates cancellation/progress, supports text/images/structured content, and offloads large results. Do not build a second adapter-specific bridge.

Account for the harness's native MCP approval policy. A server that connects and lists tools is not usable if every model-initiated call is silently rejected. When the product has already selected a Pibo-owned tool set and the credential independently enforces that exact session/generation/allowlist, an adapter may mark only that generated Pibo MCP server as pre-approved through an official harness setting. Do not apply the same policy globally or automatically to unrelated external MCP servers. Prove a model-initiated call, not only a direct protocol call.

### Native tool yielding

`tools.nativeToolYielding` is separate. `pibo_run_start` can yield Pibo-managed tool work. It cannot wrap a private native harness tool unless the adapter provides an explicit native-tool-yielding mechanism. Keep that limitation visible.

## External MCP servers

`services.resources` provides selected external MCP server configs and a generated selected-only configuration when the adapter advertises delivery.

Use:

- `getMcpConfigPath()` for materialized config;
- `getExternalMcpServerConfigs()` only inside adapter-owned launch state;
- `getAdapterEnvironment()` for scoped secret environment variables;
- `getInspection()` for safe delivery and verified inventory.

Requirements:

- include only selected servers;
- preserve transport and official harness config semantics;
- bind secret-bearing literals/arguments through session-only environment references;
- verify actual protocol initialization and tool/resource/template inventory;
- report configured versus connected versus failed accurately;
- do not mutate source MCP config or user-global harness config;
- dispose child processes/config with the generation.

A written config file is not proof of connection.

## Skills

`SKILL.md` remains Pibo's canonical skill format. The resource session exposes selected skill paths in source or materialized mode.

Use native delivery when the harness accepts additional skill roots through an official API/config. Use materialized delivery when isolated directories are supported.

Security/behavior rules:

- only selected built-in, plugin, and user skills are present;
- unselected skills never appear in adapter-visible roots;
- preserve each selected skill directory and bundled resources;
- reject escaping symlinks, cycles, excessive files, and excessive bytes;
- do not point the harness at Pibo's global skill catalog;
- report delivery mode, fidelity, target, status, and diagnostic.

Do not claim skill support merely because arbitrary prompt text can be appended. If that is the only path and genuinely useful, classify it as degraded context with a reason, not native skill support.

## Context contributions

The resource session returns ordered context contributions with intent:

- developer;
- project;
- session;
- user-visible.

Contributions may come from Pibo product context, managed/plugin context files, automatic project discovery, or generated state.

Map them into documented harness channels without replacing the native base prompt. Preserve order and intended scope. Report fidelity:

- `exact` — content and scope preserved;
- `equivalent` — semantics preserved through an official but different channel;
- `lossy` — real delivery with a documented loss;
- `none` — unsupported or failed.

Automatic AGENTS.md/CLAUDE.md discovery may be claimed for materialized adapters only when the adapter declares `native-project-discovery` and proves the harness discovers it in the isolated workspace/config.

Never include resolved secret values in context or generated instructions.

## Generated runtime paths

Materialized state lives under a private generation tree similar to:

```text
$PIBO_HOME/agent-runtimes/<runtime-instance>/<pibo-session>/<generation>/
  home/
  skills/
  context/
  config/
  protocol/
```

Directories are private and disposable. The adapter may add protocol files under its generation, but must not write outside the provided root unless the official harness requires another isolated path and the design documents it.

Do not reuse a generation after session disposal or gateway restart.

## Native prompt and tool checks

Before and after integration, capture:

- native system/developer prompt behavior;
- native standard tool inventory;
- native approval behavior;
- native project-instruction discovery;
- native session persistence.

Add tests that fail if Pibo injects Pi-specific prompt text or removes native tools. A successful answer is not enough; inspect the actual protocol/config/tool inventory when available.

## Models, auth, reasoning, and adapter options

The selected configured runtime owns these surfaces:

- `listModels()` returns only models valid for that runtime instance;
- `models.optionsSchema` describes persisted adapter-native options;
- reasoning values match exact harness values;
- live model switching is advertised only when the native protocol supports it.

Provider auth is an explicit configured-instance capability, not a global Pi service. Declare `capabilities.auth` with:

- `status` support;
- Pibo method ids (`device_code`, `browser_oauth`, or `api_key`) and each method's `immediate`, `explicit`, or `notification` completion mode;
- cancellation and logout support;
- credential scope: `runtime-instance` or `adapter-shared`.

The capability declaration and methods must match exactly:

- `getAuthStatus()` returns every known provider with connected, disconnected, pending, partial, unsupported, or failed state;
- `startAuth()` starts only declared methods;
- `completeAuth()` reads explicit/notification flow progress and terminal outcome;
- `cancelAuth()` and `logoutAuth()` exist only when claimed;
- `disposeAuth()` is required for non-immediate methods, closes pending adapter-owned processes/transient state, and leaves the configured adapter reusable after router restart.

Use only Pibo-owned provider ids, method ids, status, flow, and result types at the boundary. Generate an opaque Pibo flow id and keep native login ids, separate OAuth state/verifier fields, account identifiers, and protocol payloads inside the adapter. An interactive flow may return only the bounded verification/authorization URL, optional one-time user code, bounded instructions, and Pibo flow metadata needed by the user; never persist that ephemeral URL/code in bindings, normalized product history, screenshots, or reports.

Pibo product settings require an explicit configured-runtime target. A legacy session-bound action may target the active session's frozen runtime binding, but a random Pibo Session id must never be ignored or treated as global auth scope. Multiple configured instances may intentionally use different accounts. If the harness uses one existing shared store, declare `adapter-shared`, prevent conflicting same-provider flows across that scope, cancel scoped pending flows on logout, and recycle cached sessions for every affected instance rather than pretending the instances are isolated.

Join model providers to auth status for the same runtime instance. If that runtime declares auth but status is missing or failed, never default models to authenticated. Keep models visible with disabled/missing-auth explanation when the product spec requires discoverability.

Validate adapter options at save and start boundaries. Do not pass unknown arbitrary JSON to a process without schema validation and filtering.

Never reuse Chat Web cookies, machine keys, Pibo tool tokens, another harness's auth, local OAuth files, or browser cookies as model-provider credentials. Never use unstable token-injection protocol variants merely because they appear in generated schemas. Tests must prove target routing, timeout/cancellation, restart persistence, same-adapter instance isolation where claimed, and redaction from events, bindings, logs, diagnostics, snapshots, and reports.

## Pibo-managed subagents

Subagents remain Pibo product orchestration:

- a subagent tool creates or reuses a child Pibo Session using a bounded stable thread key;
- the child profile selects and freezes its own configured runtime instance and binding;
- parent and child may use different adapters;
- hierarchy/correlation remains in Pibo data and events;
- child tools/resources receive their own generation and credentials;
- parent interruption and tool cancellation abort active child work without deleting the reusable child session;
- `pibo_run_start` may yield selected Pibo subagent tools even when private harness-native tool yielding is unsupported.

An adapter does not need native harness subagents to support Pibo-managed subagents. It does need a working Pibo-managed tool delivery path, model-call approval semantics that actually permit the selected Pibo tool, and restart/resume evidence for the parent and child bindings.

Do not flatten a child session into an undocumented native tool call and then claim cross-runtime subagent support.

## Context Build and inspection

Agent Designer and Context Build must show:

- selected runtime instance/adapter and diagnostics;
- effective capability modes;
- selected tool delivery and portability;
- skills/context/MCP delivery status, fidelity, target, and inventory;
- disabled reasons for unsupported selections;
- redacted secret environment key names, never values;
- native prompt preservation assumptions/evidence.

Inspection may create temporary generation state but must use non-strict mode, avoid delegated work, dispose before return, and not persist a harness conversation.
