---
type: "Specification"
title: "Plugin Packages, Capabilities, and Profiles"
description: "Defines installed plugin package identity, capability ownership, product composition, profile selection, and public extension boundaries."
tags: ["product", "plugins", "profiles", "packages"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-15T02:06:30Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "d37dea0c7870e426e35911b574af1af07dfa7cd2"
  requirements:
    - id: "PROD-REG-001"
      status: "implemented"
      sources:
        - path: "src/core/capability-host.ts"
          symbol: "PiboCapabilityHost"
        - path: "src/plugins/capability-projection.ts"
          symbol: "CapabilityProjection"
      tests:
        - path: "test/plugin-registry.test.mjs"
          name: "capability host projects Core resources and installed package capabilities without retired aliases"
        - path: "test/plugin-registry.test.mjs"
          name: "capability host rejects duplicate Core registrations"
      failures:
        - "Duplicate capability ownership and invalid contribution registrations fail before they can become product authority."
      confidence: "high"
    - id: "PROD-REG-002"
      status: "implemented"
      sources:
        - path: "src/plugins/product-runtime.ts"
          symbol: "startPluginProductRuntime"
        - path: "src/plugins/default-packages.ts"
          symbol: "BUILTIN_PROFILES_PLUGIN_ID"
      tests:
        - path: "test/plugin-system-product-runtime.test.mjs"
          name: "Core exposes auth, base Web, Chat, and user resources with zero plugin installations"
        - path: "test/pibo4-packed-distribution.test.mjs"
          name: "every first-party artifact independently packs with exact identity and self-contained backend"
      failures:
        - "A disabled or uninstalled managed package is not silently re-enabled during startup."
      confidence: "high"
    - id: "PROD-REG-003"
      status: "implemented"
      sources:
        - path: "src/plugins/builtin.ts"
          symbol: "selectDefaultPiboProfileName"
        - path: "src/plugins/selection.ts"
          symbol: "createAgentPluginSelectionForProfile"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "default profiles expose configured Pi and distinct native Codex runtimes"
        - path: "test/plugin-registry.test.mjs"
          name: "gateway producer profile composes from the installed gateway tool package"
      failures:
        - "Unknown, disabled, incompatible, or ambiguous runtime and tool providers produce diagnostics instead of implicit fallback."
      confidence: "high"
    - id: "PROD-REG-004"
      status: "implemented"
      sources:
        - path: "src/plugins/sdk.ts"
          symbol: "PluginManifest"
        - path: "src/plugins/backend-loader.ts"
          symbol: "preparePluginSdkResolution"
        - path: "src/plugins/browser.ts"
          symbol: "PluginBrowserSetup"
      tests:
        - path: "test/plugin-system-public-runtime.test.mjs"
          name: "an out-of-repository package compiles and runs using only public plugin subpaths"
        - path: "test/plugin-system-backend-loader.test.mjs"
          name: "installed backend resolves the public SDK and shares the actual host ownership scope"
      failures:
        - "Unsupported SDK versions, unresolved entrypoints, invalid exports, or private imports keep the package inactive."
      confidence: "high"
    - id: "PROD-REG-005"
      status: "implemented"
      sources:
        - path: "src/plugins/manager.ts"
          symbol: "PluginManager"
        - path: "src/plugins/store.ts"
          symbol: "PluginStore"
        - path: "src/plugins/sources.ts"
          symbol: "LocalPluginSourceResolver"
      tests:
        - path: "test/plugin-system-install.test.mjs"
          name: "local and versioned package artifacts have identical content identity and inspection never imports"
        - path: "test/plugin-system-install.test.mjs"
          name: "source edits do not alter staged execution, updates wait for a safe drain"
      public:
        - "command: pibo plugins inspect|install|update|activate|status|doctor|uninstall|operations|recover|config"
      failures:
        - "Inspection and dry-run do not import code; failed staging, activation, update, or recovery cannot publish a partial active generation."
      confidence: "high"
    - id: "PROD-REG-006"
      status: "implemented"
      sources:
        - path: "src/plugins/cutover.ts"
          symbol: "isPibo4LegacyAggregatePluginId"
        - path: "src/plugins/product-runtime.ts"
          symbol: "startPluginProductRuntime"
      tests:
        - path: "test/pibo4-cutover.test.mjs"
          name: "cutover preparation maps aggregate owners, preserves negative states, and verifies exact bytes"
        - path: "test/pibo4-cutover.test.mjs"
          name: "Minimal-Core refuses a required but unprepared direct cutover before opening product data"
      failures:
        - "Legacy aggregate installations require an exact prepared cutover; mismatched bytes, target versions, or active owners fail before product data opens."
      confidence: "high"
    - id: "PROD-REG-007"
      status: "implemented"
      sources:
        - path: "package.json"
        - path: "scripts/build-pibo4-artifacts.mjs"
      tests:
        - path: "test/plugin-system-v4-source-audit.test.mjs"
          name: "Pibo 4 production source has no executable legacy plugin composition entry points"
        - path: "test/pibo4-packed-distribution.test.mjs"
          name: "packed Minimal-Core executable files exclude first-party runtime, Run, and Delegation implementations"
      public:
        - "package exports: ./plugin-sdk, ./plugin-host, ./plugin-runtime, ./product-runtime, ./plugin-cutover"
      failures:
        - "Production delivery exposes neither wildcard plugin exports nor plugin-builtin or legacy registry composition entrypoints."
      confidence: "high"
---

# Scope

This specification owns plugin artifact identity, activation authority, capability projection, first-party package composition, profile selection, and the public SDK boundary.

Core product services, Session routing, individual tool semantics, Web rendering, runtime adapter behavior, and data migration details remain with their domain specifications.

# Current behavior

- One long-lived `PiboCapabilityHost` owns product capabilities. `CapabilityProjection` gives each installed package an ownership-scoped registration surface.
- Core auth, base Web, Chat, and user resources are host-owned services. They do not appear as synthetic plugin installations.
- First-party features and runtime adapters are ordinary immutable package artifacts. Standard composition selects the required package set; Minimal-Core starts with zero plugin installations.
- Installation inspects and stages immutable content before import. Activation publishes one generation only after dependency, SDK, artifact, and ownership checks pass.
- Agent profiles select installed contributions explicitly. Runtime requirements, service dependencies, direct visibility, yieldability, portability, and built-in replacement metadata remain independent properties.
- External packages compile and run through documented package subpaths without importing repository internals.
- Pibo 4 cutover verifies the retained old package and exact target artifacts before Minimal-Core replaces legacy aggregate delivery.

# Requirements and invariants

## Requirement: PROD-REG-001: One capability authority

The product SHALL use one capability host as the runtime authority for Core resources and installed package contributions. Every contribution SHALL retain an owner, and duplicate or invalid ownership SHALL fail before publication.

## Requirement: PROD-REG-002: Core and first-party package boundary

Core SHALL provide only product infrastructure and named Core services without manufacturing installations. Optional first-party features and runtime adapters SHALL be independently identifiable, packable, installable, activatable, and removable artifacts.

## Requirement: PROD-REG-003: Installed composition and profile selection

A profile SHALL receive only contributions supplied by its effective installed-package selection and compatible runtime or service providers. The default profile remains `base`; `codex-native` and `orp` remain distinct configured profiles. No implicit `codex` profile alias is created.

## Requirement: PROD-REG-004: Public extension contract

An external backend or browser package SHALL use the public plugin SDK, host, runtime, and browser contracts. Manifest inspection SHALL not execute entrypoints. Activation SHALL reject unsupported SDK ranges, unresolved files, invalid exports, dependency failures, and ownership violations without leaving executable effects.

## Requirement: PROD-REG-005: Immutable package lifecycle

Plugin inspection, dry-run, staging, update, activation, drain, uninstall, operation recovery, and configuration SHALL use durable revisions and content identity. Source mutation after staging SHALL not change the staged executable generation. Failed work SHALL preserve the prior active generation or a recoverable non-active state.

## Requirement: PROD-REG-006: Prepared Pibo 4 cutover

Minimal-Core SHALL reject active legacy aggregate installations unless an exact cutover plan proves the old package bytes, target Core version, target package identities, and preserved disabled or uninstalled choices before product data opens.

## Requirement: PROD-REG-007: No executable legacy delivery

Production source and packed Core SHALL not expose the retired registry API, wildcard plugin exports, `plugin-builtin` delivery, aggregate first-party factories, or a second executable registration path. Isolated data migration readers and historical test fixtures MAY retain legacy shapes but SHALL NOT participate in normal composition.

# Interfaces and ownership

Public package boundaries:

- `@pasko70/pibo/plugin-sdk`: manifest, setup, browser, and contribution types.
- `@pasko70/pibo/plugin-host`: host planning and activation contracts.
- `@pasko70/pibo/plugin-runtime`: Session-scoped runtime service contracts.
- `@pasko70/pibo/product-runtime`: product startup and package-manager wiring.
- `@pasko70/pibo/plugin-cutover`: prepared Pibo 4 upgrade verification.
- `pibo plugins`: iterative inspection, installation, activation, diagnostics, recovery, configuration, and uninstall operations.

The capability host owns registration truth. `PluginManager` owns durable package lifecycle. `PluginHost` owns dependency planning and generation activation. Profiles own their saved package selection; they do not own package installation state.

# Failure and security behavior

- Inspection does not import package code.
- Artifact hashes are verified before the first backend import.
- Configuration validates finite JSON against the package schema; credential values use secret references.
- Activation and removal drain affected work and clean ownership-scoped registrations. Cleanup failures remain visible and block an unsafe success claim.
- Missing or incompatible providers fail with diagnostics; the host does not silently substitute a legacy implementation.

# Known limits

- Pibo does not install arbitrary package dependencies during safe plugin installation. Distributed artifacts must contain their runtime closure and use only supported public peers.
- First-party package publication, remote registry policy, signing, and release promotion remain release-process concerns rather than runtime behavior.
- Real-provider and Pibo2 acceptance are not implied by the local source and test traceability in this specification.

# Verification and traceability

Source symbols and named tests are bound to commit `d37dea0c7870e426e35911b574af1af07dfa7cd2`.

Focused verification at that commit included:

- TypeScript compilation and Pibo 4 artifact construction.
- The serial F08 source, manifest, runtime, browser, and parity set: 105 tests passed, 0 failed.
- The isolated gateway integration set: 5 tests passed, 0 failed, with process cleanup confirmed.
- The Pi-to-Codex yielded-argument parity and durable Codex binding restart/deletion tests passed without weakening their assertions.

# Related concepts

- [App Context Composition](/specs/product/app-context.md)
- [Agent Runtime Adapter Contract](/specs/runtime/adapter-contract.md)
- [Authenticated Web Host and Channel](/specs/gateway/web-host-and-channel.md)
- [Session Workspace Lifecycle](/specs/web/session-workspace-lifecycle.md)
- [Pibo 4.0 plugin completion plan](/plans/pibo-4-0-plugin-completion.md)
