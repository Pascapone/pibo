---
type: "Specification"
title: "Oh My Pi RPC Adapter"
description: "Defines the ORP-registered Oh My Pi RPC runtime, its operator configuration, process/RPC lifecycle, host tools, resources, history, models, and controls."
tags: ["runtime", "omp", "orp", "adapter", "rpc"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-05T12:20:39Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "9ce53817fec5919c00e130dd794c391c497882a1"
  requirements:
    - id: "RUN-OMP-001"
      status: "implemented"
      sources:
        - path: "src/plugins/omp.ts"
          symbol: "piboOmpPlugin"
        - path: "src/agent-runtimes/omp/thread.ts"
          symbol: "OMP_ADAPTER_ID"
        - path: "src/agent-runtimes/omp/models.ts"
          symbol: "OMP_MODEL_PROVIDER_ID"
      tests:
        - path: "test/omp-resources.test.mjs"
          name: "OMP adapter driver descriptor declares truthful capabilities"
      failures:
        - "Missing operator CLI/home configuration diagnoses unavailable and refuses spawn; transport and history inconsistencies fail explicitly; diagnostics redact credentials."
        - "The process uses private instance/session directories, an environment allowlist, and explicit provider-key forwarding; unbound reset removes stale native transcripts/handoffs."
      confidence: "high"
    - id: "RUN-OMP-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/omp/config.ts"
          symbol: "parseOmpRuntimeConfig"
        - path: "src/agent-runtimes/omp/process.ts"
          symbol: "diagnoseOmpRuntime"
        - path: "src/agent-runtimes/omp/protocol-version.ts"
          symbol: "OMP_CLI_VERSION"
      tests:
        - path: "test/omp-runtime.test.mjs"
          name: "OMP runtime config parses and validates provider defaults"
        - path: "test/omp-resources.test.mjs"
          name: "OMP process environment isolates the agent dir and passes provider API keys"
        - path: "test/omp-runtime.test.mjs"
          name: "OMP diagnostics require the exact validated CLI version"
      failures:
        - "Missing operator CLI/home configuration diagnoses unavailable and refuses spawn; transport and history inconsistencies fail explicitly; diagnostics redact credentials."
        - "The process uses private instance/session directories, an environment allowlist, and explicit provider-key forwarding; unbound reset removes stale native transcripts/handoffs."
      confidence: "medium"
    - id: "RUN-OMP-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/omp/client.ts"
          symbol: "OmpRpcClient"
        - path: "src/agent-runtimes/omp/turn.ts"
          symbol: "OmpRpcTurnController"
        - path: "src/agent-runtimes/omp/adapter.ts"
          symbol: "OMP_RUNTIME_CAPABILITIES"
      tests:
        - path: "test/omp-runtime.test.mjs"
          name: "OMP RPC client performs ready handshake then protocol negotiation"
        - path: "test/omp-runtime.test.mjs"
          name: "OMP turn controller resolves a stalled stream via the deadline"
        - path: "test/omp-runtime.test.mjs"
          name: "OMP RPC client redacts credential material from diagnostics"
        - path: "test/omp-resources.test.mjs"
          name: "OMP adapter driver descriptor declares truthful capabilities"
      failures:
        - "Missing operator CLI/home configuration diagnoses unavailable and refuses spawn; transport and history inconsistencies fail explicitly; diagnostics redact credentials."
        - "The process uses private instance/session directories, an environment allowlist, and explicit provider-key forwarding; unbound reset removes stale native transcripts/handoffs."
      confidence: "high"
    - id: "RUN-OMP-004"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/omp/host-tools.ts"
          symbol: "OmpHostToolBridge"
        - path: "src/agent-runtimes/omp/resource-delivery.ts"
          symbol: "OmpResourceDelivery"
      tests:
        - path: "test/omp-resources.test.mjs"
          name: "OMP resource-delivery writes additive context and passes it through --append-system-prompt"
        - path: "test/omp-resources.test.mjs"
          name: "OMP resource-delivery persists portable history and blocks every native task entry point"
        - path: "test/runtime-portability.test.mjs"
          name: "runtime rebind persists a retry-safe handoff and imports it before opening the target session"
      failures:
        - "Missing operator CLI/home configuration diagnoses unavailable and refuses spawn; transport and history inconsistencies fail explicitly; diagnostics redact credentials."
        - "The process uses private instance/session directories, an environment allowlist, and explicit provider-key forwarding; unbound reset removes stale native transcripts/handoffs."
      confidence: "high"
---

# Scope

Own the pibo.orp plugin, orp profile/adapter identity, omp-native configured instance, OMP process/RPC protocol, host tools, resource delivery, history, model mapping, and supported controls.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: The client waits for ready then negotiates protocol; prompts stream to agent_end or a bounded deadline; abort interrupts; binding resumes persisted native identity after restart. OMP does not declare running-safe fork support because its fork RPC changes the process-owned current session, so candidate reads and forks remain idle-only.
- State: Exact names are plugin pibo.orp, profile/adapter orp, configured instance omp-native, validated CLI 18.1.10, protocol omp-rpc v2 with v1/v2 accepted, model provider omp.
- Failure: Missing operator CLI/home configuration diagnoses unavailable and refuses spawn; transport and history inconsistencies fail explicitly; diagnostics redact credentials.
- Security: The process uses private instance/session directories, an environment allowlist, and explicit provider-key forwarding; unbound reset removes stale native transcripts/handoffs.
- Compatibility: Startup accepts only the exactly validated OMP CLI 18.1.10; modern fork commands fall back to legacy branch RPC names only when unsupported; external MCP and native yielding remain unsupported.

# Requirements and invariants

## Requirement: RUN-OMP-001

The OMP plugin SHALL register plugin pibo.orp, profile and adapter orp, configured instance omp-native, protocol omp-rpc, and model provider omp exactly as implemented.

## Requirement: RUN-OMP-002

OMP startup SHALL require an absolute operator-provided CLI or home configuration, use private runtime paths and an allowlisted environment, require the exactly validated CLI version 18.1.10, and refuse spawn when unavailable or unsupported.

## Requirement: RUN-OMP-003

The OMP client SHALL perform ready and protocol negotiation, correlate RPC by id, stream turns to terminal state or deadline, support abort, and redact diagnostics. OMP SHALL keep `lifecycle.forkWhileRunning` disabled while its fork RPC mutates the process-owned current session.

## Requirement: RUN-OMP-004

OMP resource delivery SHALL expose selected Pibo tools as RPC host tools, append additive context, persist portable history before first target prompt, and disable every native task entry point.

# Interfaces and ownership

Implemented public contracts:

- `piboOmpPlugin`
- `OMP_PROFILE_NAME`
- `OMP_RUNTIME_INSTANCE_ID`
- `OMP_ADAPTER_ID`
- `OMP_AGENT_RUNTIME_DRIVER`
- `OmpRpcClient`
- `OmpSession`
- `OmpHostToolBridge`
- `OmpResourceDelivery`

Related ownership boundaries:

- `SPC-RUN-001`: generic adapter contract.
- `SPC-RUN-003`: portable resource/tool selection.
- `SPC-RUN-008`: cross-runtime control precedence.

# Failure and security behavior

- Missing operator CLI/home configuration diagnoses unavailable and refuses spawn; transport and history inconsistencies fail explicitly; diagnostics redact credentials.
- The process uses private instance/session directories, an environment allowlist, and explicit provider-key forwarding; unbound reset removes stale native transcripts/handoffs.

# Known limits

- Evidence gap: OmpAuthController exists, but the generic adapter startAuth path does not provide a demonstrated end-to-end login flow; document only inspected status/cancel/logout behavior until a focused test exists.
- Non-current claim excluded: omp is the registered profile or adapter id.
- Non-current claim excluded: orp is the model provider id or protocol name.
- Non-current claim excluded: OMP auto-discovers a workspace-local CLI when operator configuration is absent.
- Non-current claim excluded: OMP supports external MCP or native Pibo tool yielding.

# Verification and traceability

Source symbols and named tests are bound to commit `9ce53817fec5919c00e130dd794c391c497882a1`. Requirement confidence measures trace quality, not whether a command ran.

A real `@oh-my-pi/pi-coding-agent@18.1.10` installation under Bun 1.4.1 passed the protocol-v2 handshake plus `get_state`, `set_host_tools`, and `get_available_commands`. The additive `advisor_cost_changed` event remains safely tolerated by the client's unknown-event handling.

Package verification commands:

- `npm run build`
- `node --test test/omp-runtime.test.mjs test/omp-resources.test.mjs test/runtime-portability.test.mjs`

# Related concepts

- `SPC-RUN-001` owns generic adapter contract.
- `SPC-RUN-003` owns portable resource/tool selection.
- `SPC-RUN-008` owns cross-runtime control precedence.
