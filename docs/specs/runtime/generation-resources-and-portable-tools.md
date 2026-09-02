---
type: "Specification"
title: "Runtime Generation Resources and Portable Tool Bridge"
description: "Defines generation-scoped resource preparation, observed adapter delivery, portable tool selection, credentials, and the loopback MCP bridge."
tags: ["runtime", "resources", "tools", "mcp", "credentials"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T04:15:54Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "RUN-RES-001"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/resource-service.ts"
          symbol: "PiboRuntimeResourceService"
        - path: "src/agent-runtime/resource-files.ts"
          symbol: "copyAgentRuntimeSkillDirectory"
      tests:
        - path: "test/agent-runtime-resource-service.test.mjs"
          name: "runtime resources isolate selected skills, context, MCP config, secrets, and verified inventory"
      failures:
        - "Missing secret references, escaping/cyclic symlinks, unsupported transports, unverified MCP delivery, and expired/revoked credentials fail closed."
        - "MCP binds only to loopback, exposes an exact allowlist, hashes bearer credentials, scopes them to session/generation, and excludes adapter-private non-portable tools."
      confidence: "high"
    - id: "RUN-RES-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/resources.ts"
          symbol: "AgentRuntimeDeliveryReport"
      tests:
        - path: "test/agent-runtime-resource-service.test.mjs"
          name: "runtime resources expose adapter-observed delivery instead of generic capability guesses"
      failures:
        - "Missing secret references, escaping/cyclic symlinks, unsupported transports, unverified MCP delivery, and expired/revoked credentials fail closed."
        - "MCP binds only to loopback, exposes an exact allowlist, hashes bearer credentials, scopes them to session/generation, and excludes adapter-private non-portable tools."
      confidence: "high"
    - id: "RUN-RES-003"
      status: "implemented"
      sources:
        - path: "src/tools/session-service.ts"
          symbol: "PiboPortableToolService"
        - path: "src/tools/session-tool-set.ts"
          symbol: "createPiboSessionToolDefinitions"
      tests:
        - path: "test/pibo-portable-tool-session.test.mjs"
          name: "portable tool sessions share one frozen tool selection across direct and MCP delivery"
      failures:
        - "Missing secret references, escaping/cyclic symlinks, unsupported transports, unverified MCP delivery, and expired/revoked credentials fail closed."
        - "MCP binds only to loopback, exposes an exact allowlist, hashes bearer credentials, scopes them to session/generation, and excludes adapter-private non-portable tools."
      confidence: "high"
    - id: "RUN-RES-004"
      status: "implemented"
      sources:
        - path: "src/tools/credential-registry.ts"
          symbol: "PiboToolCredentialRegistry"
      tests:
        - path: "test/pibo-tool-mcp-bridge.test.mjs"
          name: "session tool credentials are hashed, scoped, renewable, expiring, and revocable"
      failures:
        - "Missing secret references, escaping/cyclic symlinks, unsupported transports, unverified MCP delivery, and expired/revoked credentials fail closed."
        - "MCP binds only to loopback, exposes an exact allowlist, hashes bearer credentials, scopes them to session/generation, and excludes adapter-private non-portable tools."
      confidence: "high"
    - id: "RUN-RES-005"
      status: "implemented"
      sources:
        - path: "src/tools/mcp-bridge.ts"
          symbol: "PiboToolMcpBridge"
      tests:
        - path: "test/pibo-tool-mcp-bridge.test.mjs"
          name: "MCP bridge rejects non-loopback bind addresses"
        - path: "test/pibo-tool-mcp-bridge.test.mjs"
          name: "session-scoped MCP bridge enforces tool isolation and preserves progress, content, errors, correlation, and large results"
      failures:
        - "Missing secret references, escaping/cyclic symlinks, unsupported transports, unverified MCP delivery, and expired/revoked credentials fail closed."
        - "MCP binds only to loopback, exposes an exact allowlist, hashes bearer credentials, scopes them to session/generation, and excludes adapter-private non-portable tools."
      confidence: "high"
---

# Scope

Own resource/tool generation isolation, selected skill/context/MCP materialization, delivery reports, portable tool contracts, scoped credentials, and loopback MCP exposure.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: The router creates one isolated generation for tools and resources and disposes both after use; active credentials may renew only within bounded lifetime.
- State: The direct and MCP paths share one frozen selected tool set; delivery status is observed as delivered, degraded, unsupported, or failed.
- Failure: Missing secret references, escaping/cyclic symlinks, unsupported transports, unverified MCP delivery, and expired/revoked credentials fail closed.
- Security: MCP binds only to loopback, exposes an exact allowlist, hashes bearer credentials, scopes them to session/generation, and excludes adapter-private non-portable tools.
- Compatibility: Legacy Pi-shaped tool registrations normalize into the portable contract without leaking Pi types into generic profiles.

# Requirements and invariants

## Requirement: RUN-RES-001

The runtime resource service SHALL isolate selected skills, context, MCP configuration, secret references, and inspection state per generation.

## Requirement: RUN-RES-002

Resource delivery SHALL report adapter-observed delivered, degraded, unsupported, or failed outcomes rather than infer success from declared capability alone.

## Requirement: RUN-RES-003

One frozen generation-scoped tool selection SHALL back both direct execution and MCP delivery.

## Requirement: RUN-RES-004

Portable tool credentials SHALL be hashed, session/generation scoped, renewable, expiring, and revocable, with a default 5-minute lease and 30-minute maximum lifetime.

## Requirement: RUN-RES-005

The MCP bridge SHALL bind only to loopback and enforce the exact portable-tool allowlist while preserving progress, correlation, content, errors, and bounded large-result handling.

# Interfaces and ownership

Implemented public contracts:

- `PiboRuntimeResourceService`
- `PiboRuntimeResourceSession`
- `AgentRuntimeDeliveryReport`
- `PiboToolDefinition`
- `PiboPortableToolService`
- `PiboToolCredentialRegistry`
- `PiboToolMcpBridge`
- `createPiboSessionToolDefinitions`

Related ownership boundaries:

- `SPC-RUN-004`: Pi direct-tool/native-context mechanics.
- `SPC-RUN-005`: Codex Native MCP and skill delivery mechanics.
- `SPC-RUN-006`: ORP host-tool and prompt-append mechanics.
- `SPC-SEC-001`: global secret policy and external credential ownership.

# Failure and security behavior

- Missing secret references, escaping/cyclic symlinks, unsupported transports, unverified MCP delivery, and expired/revoked credentials fail closed.
- MCP binds only to loopback, exposes an exact allowlist, hashes bearer credentials, scopes them to session/generation, and excludes adapter-private non-portable tools.

# Known limits

- No open source-trace gap is recorded for this contract.
- Non-current claim excluded: Declared adapter capability proves resource delivery.
- Non-current claim excluded: Every runtime receives tools over MCP.
- Non-current claim excluded: Adapter-private tools are portable by default.
- Non-current claim excluded: Skill symlinks may escape the selected skill root.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/agent-runtime-resource-service.test.mjs test/codex-native-resources.test.mjs test/omp-resources.test.mjs test/pibo-tool-contract.test.mjs test/pibo-tool-mcp-bridge.test.mjs test/pibo-portable-tool-session.test.mjs`

# Related concepts

- `SPC-RUN-004` owns Pi direct-tool/native-context mechanics.
- `SPC-RUN-005` owns Codex Native MCP and skill delivery mechanics.
- `SPC-RUN-006` owns ORP host-tool and prompt-append mechanics.
- `SPC-SEC-001` owns global secret policy and external credential ownership.
