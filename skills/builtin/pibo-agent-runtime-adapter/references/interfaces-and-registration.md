# Interfaces and Registration

Use this reference when creating the runtime driver, configured adapter instance, live session, plugin registration, or import-boundary plan.

## Current source map

Read the implementation before copying a pattern:

- `src/agent-runtime/types.ts` — descriptor, driver, adapter, open input, session, controls, status, models/auth, diagnostics.
- `src/agent-runtime/capabilities.ts` — complete capability shape and consistency validation.
- `src/agent-runtime/registry.ts` — id/config/instance registration, diagnostics, model/auth inspection, history-provider enforcement, session contract enforcement.
- `src/agent-runtime/contract.ts` — live session methods implied by advertised capabilities.
- `src/agent-runtime/testing/fake-adapter.ts` — deterministic minimal adapter.
- `src/agent-runtime/testing/contract.ts` — reusable lifecycle/prompt/event/abort/disposal contract.
- `src/plugins/types.ts` and `src/plugins/registry.ts` — plugin-facing registration and capability catalog.
- `src/agent-runtimes/pi/adapter.ts` — compatibility-rich embedded adapter example, not a generic template.
- `test/agent-runtime-boundaries.test.mjs` — import rules.

## Four distinct layers

### Driver

The driver describes one adapter type and creates configured instances. It owns:

- stable adapter id;
- display name and transport;
- operator config JSON Schema;
- declared capabilities;
- protocol name/range;
- default config and config parsing;
- configured adapter construction.

The driver is registration-time state, not one live conversation.

### Configured adapter instance

An `AgentRuntimeAdapter` represents one named operator configuration such as `codex-native`, `codex-work`, or `remote-orion`. It owns:

- parsed config;
- enabled state;
- availability/version diagnostics;
- profile validation;
- optional model/auth/profile/history/binding inspection;
- creation of isolated live sessions.

Do not put one session's process, subscription, current thread, credential, or generated directory in unkeyed adapter fields.

### Live runtime session

An `AgentRuntimeSession` represents one active Pibo Session generation. It owns:

- native process/client/thread handle;
- current frozen binding;
- subscriptions and correlation maps;
- prompt/steer/abort behavior;
- pending approval/input requests;
- generated configuration and credentials supplied by Pibo services;
- idempotent disposal.

### Pibo routed session

`RuntimeRoutedSession` is product orchestration. It owns queues, active-message correlation, Pibo event distribution, controls dispatch, continuation policy, and product actions. Do not move harness protocol code into it.

## Driver skeleton

Adapt this shape; do not copy unsupported capabilities from another adapter.

```ts
import type {
  AgentRuntimeAdapter,
  AgentRuntimeCapabilities,
  AgentRuntimeDriver,
  AgentRuntimeDriverCreateInput,
  PiboJsonObject,
} from "@pasko70/pibo";

type OrionConfig = PiboJsonObject & {
  executable: string;
  startupTimeoutMs: number;
};

const capabilities: AgentRuntimeCapabilities = /* evidence-based matrix */;

export const ORION_RUNTIME_DRIVER: AgentRuntimeDriver<OrionConfig> = {
  descriptor: {
    id: "orion",
    displayName: "Orion App Server",
    transport: "stdio-rpc",
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        executable: { type: "string", minLength: 1 },
        startupTimeoutMs: { type: "integer", minimum: 1000 },
      },
      required: ["executable", "startupTimeoutMs"],
    },
    capabilities,
    protocol: { name: "orion-app-server", supportedRange: ">=2.4 <3" },
    supportsMultipleInstances: true,
  },
  defaultConfig() {
    return { executable: "orion", startupTimeoutMs: 15_000 };
  },
  parseConfig(value) {
    // Validate every field and reject unknown/unsafe values.
    return parseOrionConfig(value);
  },
  create(input: AgentRuntimeDriverCreateInput<OrionConfig>): AgentRuntimeAdapter {
    return new OrionAgentRuntimeAdapter(input, capabilities);
  },
};
```

The registry validates descriptor ids and the capability object. It clones raw config, calls `parseConfig()`, and verifies that the created adapter reports the requested instance and adapter ids.

## Plugin registration

Register the driver before instances:

```ts
export const orionPlugin = definePiboPlugin({
  id: "pibo.runtime.orion",
  name: "Orion Runtime",
  register(api) {
    api.registerAgentRuntimeDriver(ORION_RUNTIME_DRIVER);
    api.registerAgentRuntimeInstance({
      id: "orion-native",
      adapterId: "orion",
      displayName: "Orion Native",
      enabled: true,
      config: { executable: "orion", startupTimeoutMs: 15_000 },
    });
  },
});
```

A profile selects the configured instance id, not the adapter id. Existing sessions keep their frozen binding when a profile default changes.

Do not claim a compatibility alias owned by another profile. Native Codex, for example, uses `codex-native`; it does not reinterpret a persisted Pi-backed `codex` reference.

## Adapter required methods

Every configured adapter implements:

- `diagnose()` — bounded availability/version/config diagnostics;
- `validateProfile()` — adapter-specific profile diagnostics;
- `openSession()` — creates one isolated live session.

Optional methods are capability-driven:

- `inspectProfile()` for delivery/fidelity inspection;
- `listModels()` when `models.catalog` is true;
- `getAuthStatus()` for safe auth presence/status;
- `inspectHistory()` and `readHistory()` together when `maintenance.history` is true;
- `resolveBinding()` when native state needs adapter-owned verification/repair.

Do not return raw stderr, process environment, token values, cookies, generated config contents, or locator values in general diagnostics.

## Session required methods

Every live session implements:

- identity: `adapterId`, `runtimeInstanceId`, `cwd`;
- `capabilities` matching actual live behavior;
- `getBinding()`;
- `subscribe()` with unsubscribe;
- `prompt()`;
- `abort()`;
- `dispose()`;
- `getStatus()`.

`dispose()` must be safe to call twice. The registry's shared contract does this deliberately.

Optional `steer()` and `controls` methods must agree with capabilities. `assertAgentRuntimeSessionContract()` rejects mismatches.

## Diagnostics

Use stable diagnostic codes and safe messages:

```ts
{
  severity: "error",
  code: "orion_executable_not_found",
  message: "Orion executable is not available for runtime instance \"orion-native\".",
  path: "config.executable"
}
```

Prefer diagnostics over throwing for inspectable availability/profile problems. Throw for impossible construction, malformed protocol state, or an operation that cannot continue safely.

## Extension-point map

| Need | Extension point |
|---|---|
| New harness type | `AgentRuntimeDriver` |
| Operator-specific config | `AgentRuntimeInstanceDefinition` |
| Per-session native process/thread | `AgentRuntimeAdapter.openSession()` |
| Runtime event stream | `AgentRuntimeSession.subscribe()` |
| Optional controls | `AgentRuntimeControls` plus capability flags |
| Model catalog | `AgentRuntimeAdapter.listModels()` |
| Auth inspection | `AgentRuntimeAdapter.getAuthStatus()` |
| Native history | `inspectHistory()` and `readHistory()` |
| Binding verification | `resolveBinding()` |
| Profile delivery inspection | `inspectProfile()` / resource inspection |
| Pibo-managed tools | `input.services.portableTools` |
| Selected skills/context/MCP | `input.services.resources` |
| Contract fixtures | `src/agent-runtime/testing/` |

## Import boundaries

Generic code under `src/agent-runtime/`, routing, sessions, tools, data, trace, and debug may depend on Pibo-owned contracts. It must not import an adapter SDK or protocol package.

Put harness code under `src/agent-runtimes/<adapter>/`. Compatibility facades must be narrow, documented, and allowlisted by architectural tests. Prefer dependency injection and capability dispatch over `if (adapterId === "...")`.
