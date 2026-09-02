---
type: "Specification"
title: "Plugin Registry, Built-ins, and Default Profiles"
description: "Defines registry extension points, built-in registrations, default profile selection, and user profile resource registration."
tags: ["product", "plugins", "profiles", "catalog"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "PROD-REG-001"
      status: "implemented"
      sources:
        - path: "src/plugins/registry.ts"
          symbol: "PiboPluginRegistry"
        - path: "src/plugins/types.ts"
          symbol: "PiboPluginApi"
      tests:
        - path: "test/plugin-registry.test.mjs"
          name: "plugin registry rejects duplicate registrations"
      failures:
        - "Duplicate registrations, unknown instances, invalid options, and capability/method mismatches are rejected."
        - "User skills remain distinct from plugin skills and are exposed only through explicit resource registration."
      confidence: "high"
    - id: "PROD-REG-002"
      status: "implemented"
      sources:
        - path: "src/plugins/builtin.ts"
          symbol: "createDefaultPiboPlugins"
      tests:
        - path: "test/plugin-registry.test.mjs"
          name: "default plugin registry builds core and native Codex capabilities without retired aliases"
      failures:
        - "Duplicate registrations, unknown instances, invalid options, and capability/method mismatches are rejected."
        - "User skills remain distinct from plugin skills and are exposed only through explicit resource registration."
      confidence: "high"
    - id: "PROD-REG-003"
      status: "implemented"
      sources:
        - path: "src/core/default-profile.ts"
          symbol: "DEFAULT_PIBO_PROFILE_NAME"
        - path: "src/plugins/builtin.ts"
          symbol: "selectDefaultPiboProfileName"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "default profiles expose configured Pi and distinct native Codex runtimes"
        - path: "test/profile-cli.test.mjs"
          name: "pibo profile exposes native Codex without claiming the codex compatibility alias"
      failures:
        - "Duplicate registrations, unknown instances, invalid options, and capability/method mismatches are rejected."
        - "User skills remain distinct from plugin skills and are exposed only through explicit resource registration."
      confidence: "high"
    - id: "PROD-REG-004"
      status: "implemented"
      sources:
        - path: "src/plugins/codex-compat.ts"
          symbol: "piboCodexCompatPlugin"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "an explicitly registered codex profile alias remains Pi compatibility"
      failures:
        - "Duplicate registrations, unknown instances, invalid options, and capability/method mismatches are rejected."
        - "User skills remain distinct from plugin skills and are exposed only through explicit resource registration."
      confidence: "high"
---

# Scope

Own plugin registration, duplicate rejection, capability catalog assembly, built-in plugin ordering, default-profile selection, and profile resource registration.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: Plugins register definitions before profiles are created; user profile resources are added as separate plugins.
- State: The default registry profiles are base, codex-native, and orp; base is the default profile.
- Failure: Duplicate registrations, unknown instances, invalid options, and capability/method mismatches are rejected.
- Security: User skills remain distinct from plugin skills and are exposed only through explicit resource registration.
- Compatibility: Legacy requests for the former default resolve to base; no default codex profile alias is registered.

# Requirements and invariants

## Requirement: PROD-REG-001

The registry SHALL reject duplicate plugin-owned registrations and expose typed profiles, actions, listeners, and capability catalog entries.

## Requirement: PROD-REG-002

The default plugin set SHALL register core, Codex Native, Codex compatibility capabilities, web annotations, ORP, and transcription plugins in the implemented order.

## Requirement: PROD-REG-003

The default registry SHALL expose profiles base, codex-native, and orp, select base by default, and SHALL not create a codex profile alias.

## Requirement: PROD-REG-004

A codex compatibility profile alias SHALL exist only when an external plugin explicitly registers it and SHALL remain Pi-backed.

# Interfaces and ownership

Implemented public contracts:

- `PiboPluginRegistry`
- `definePiboPlugin`
- `createDefaultPiboPlugins`
- `createDefaultPiboPluginRegistry`
- `selectDefaultPiboProfileName`
- `createPiboUserProfileResourcePlugins`

Related ownership boundaries:

- `SPC-RUN-001`: runtime adapter SPI and capability truthfulness.
- `SPC-RUN-004`: Pi adapter behavior.
- `SPC-RUN-005`: Codex Native adapter behavior.
- `SPC-RUN-006`: ORP/OMP adapter behavior.

# Failure and security behavior

- Duplicate registrations, unknown instances, invalid options, and capability/method mismatches are rejected.
- User skills remain distinct from plugin skills and are exposed only through explicit resource registration.

# Known limits

- No open source-trace gap is recorded for this contract.
- Non-current claim excluded: codex is a default profile alias.
- Non-current claim excluded: omp is a registered default profile name.
- Non-current claim excluded: The compatibility plugin itself registers a codex profile.

# Verification and traceability

Source symbols and named tests are bound to commit `39090b8850758293e69380a52bb7498d7c955bc2`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/plugin-registry.test.mjs test/agent-runtime-registry.test.mjs test/profile-default-compat.test.mjs test/profile-cli.test.mjs`

# Related concepts

- `SPC-RUN-001` owns runtime adapter SPI and capability truthfulness.
- `SPC-RUN-004` owns Pi adapter behavior.
- `SPC-RUN-005` owns Codex Native adapter behavior.
- `SPC-RUN-006` owns ORP/OMP adapter behavior.
