---
type: "Specification"
title: "Plugin Packages, Capabilities, and Profiles"
description: "Defines installed plugin package identity, capability ownership, product composition, profile selection, and public extension boundaries."
tags: ["product", "plugins", "profiles", "packages"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-22T12:41:15Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "a1ccc8d9c2410720ef6c1c2b13e2dab51e8991cb"
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
        - path: "src/attachments/providers.ts"
          symbol: "createProviderRegistryClient"
        - path: "src/apps/chat-ui/src/plugins/browser-host.tsx"
          symbol: "BrowserPluginHost"
      tests:
        - path: "test/plugin-system-public-runtime.test.mjs"
          name: "an out-of-repository package compiles and runs using only public plugin subpaths"
        - path: "test/plugin-system-backend-loader.test.mjs"
          name: "installed backend resolves the public SDK and shares the actual host ownership scope"
        - path: "test/attachment-provider-registry.test.mjs"
          name: "attachment providers use the existing backend resource projection and owning scope"
        - path: "test/plugin-system-browser.test.mjs"
          name: "attachment browser provider is declaration-bound, session-bound and disposed with its owner"
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
        - path: "scripts/build-pibo4-minimal-core.mjs"
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
    - id: "PROD-REG-008"
      status: "implemented"
      sources:
        - path: "package.json"
          symbol: "private"
        - path: "package.json"
          symbol: "scripts.prepublishOnly"
        - path: "scripts/release.mjs"
          symbol: "pibo4ReleasePackages"
        - path: "scripts/build-pibo4-artifacts.mjs"
          symbol: "releaseVersion"
        - path: "scripts/build-pibo4-minimal-core.mjs"
          symbol: "releaseVersion"
      tests:
        - path: "test/npm-package-contents.test.mjs"
          name: "repository root refuses direct npm publication"
        - path: "test/npm-package-contents.test.mjs"
          name: "generated Minimal-Core tarball excludes repository and feature implementation surfaces"
        - path: "test/release-script.test.mjs"
          name: "release publishes only generated Minimal-Core, Cutover, plugin, and Standard packages"
        - path: "test/pibo4-packed-distribution.test.mjs"
          name: "standard artifact set maps every package to one exact plugin id and version"
      public:
        - "release artifacts: @pasko70/pibo, @pasko70/pibo-cutover, @pasko70/pibo-plugin-*, @pasko70/pibo-standard"
      failures:
        - "The repository root is marked private and its prepublish guard rejects direct publication. Release aborts on wrong artifact identities, versions, duplicate package names, or inconsistent Standard pins before npm publication. Publication is sequential and not atomic across packages."
      confidence: "high"
    - id: "PROD-REG-009"
      status: "implemented"
      sources:
        - path: "src/plugins/selection.ts"
          symbol: "createAgentPluginSelectionForProfile"
        - path: "src/plugins/selection.ts"
          symbol: "profileSelectedPluginIds"
      tests:
        - path: "test/plugin-system-test-profile-visibility.test.mjs"
          name: "annotation-intent profiles expose the complete Web Annotations UI family"
        - path: "test/plugin-system-test-profile-visibility.test.mjs"
          name: "profiles without annotation intent and stored explicit disables remain disabled"
      public:
        - "Agent profile tool, skill, workspace-view, projection, and session-tab contribution selections"
      failures:
        - "Annotation test intent cannot silently enable unrelated Web Annotation mutation tools."
        - "Profile-derived defaults cannot override a stored explicit per-contribution disable."
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
- A profile that explicitly selects a Web Annotations tool or skill receives the package's discoverability family—Annotations, Build Context, Terminal, and skill view—needed for test operation. This derived default does not enable unrelated mutation tools and never overrides a stored explicit disable.
- External packages compile and run through documented package subpaths without importing repository internals.
- Pibo 4 cutover verifies the retained old package and exact target artifacts before Minimal-Core replaces legacy aggregate delivery.
- The repository root is a private build workspace, not an npm release package. Its prepublish guard rejects direct publication. The release wrapper publishes only the generated Minimal-Core, Cutover, individual plugin, and Standard directories after identity, version, and dependency-pin verification.

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

## Requirement: PROD-REG-008: Physical npm release boundary

The repository root SHALL remain marked private and its prepublish guard SHALL reject direct publication as `@pasko70/pibo`. The npm release path SHALL build, verify, and publish the generated Minimal-Core, Cutover, every package listed by Standard, and Standard itself from separate package directories. Minimal-Core SHALL exclude first-party feature implementations; Standard SHALL pin the exact Core and plugin versions. Any identity, version, duplicate-name, or pin mismatch SHALL fail before the first publish.

## Requirement: PROD-REG-009: Test-profile discoverability preserves explicit disables

When a profile explicitly selects a Web Annotations tool or skill, profile-derived selection SHALL expose the package's Annotations, Build Context, Terminal, and skill-view contributions so the feature is discoverable and testable in Chat Web. This derivation SHALL NOT enable unrelated annotation mutation tools. A persisted explicit `false` for any contribution remains authoritative across recalculation, restart, and package-plan creation.

# Interfaces and ownership

Public package boundaries:

- `@pasko70/pibo/plugin-sdk`: manifest, setup, browser, and contribution types.
- `@pasko70/pibo/plugin-host`: host planning and activation contracts.
- `@pasko70/pibo/plugin-runtime`: Session-scoped runtime service contracts.
- `@pasko70/pibo/product-runtime`: product startup and package-manager wiring.
- `@pasko70/pibo/plugin-cutover`: prepared Pibo 4 upgrade verification.
- `pibo plugins`: iterative inspection, installation, activation, diagnostics, recovery, configuration, and uninstall operations.

The capability host owns registration truth. `PluginManager` owns durable package lifecycle. `PluginHost` owns dependency planning and generation activation. Profiles own their saved package selection; they do not own package installation state.

## Attachment provider registration

The public SDK exports the neutral `K07AttachmentProvider` types, `ATTACHMENT_PROVIDER_KIND` (`attachment-provider`) and `ATTACHMENT_PROVIDER_RESOURCE_KIND` (`resource:attachment-provider`). Backend providers register through the existing `registerResource` API; `PiboCapabilityHost.getAttachmentProvider(type)` reads the existing live capability projection. Removal follows the plugin owner scope; there is no second registration authority.

Browser modules use `registerAttachmentProvider(contributionId, provider)`. The contribution must be effective at the pinned plugin revision, have kind `attachment-provider`, and declare `name === provider.type`. Providers cannot replace `pibo.core/*` types. Duplicate, undeclared, malformed or mismatched registrations fail setup and roll back that scope. The browser lookup is bound to the host's Pibo Session, returns nothing for a foreign Session or disposed host, and removes registrations on disposal or setup failure.

The shared provider client revalidates the live declaration in O(schema size) per lookup and checks both the supported schema version and provider validation. Its deliberately limited schema window rejects unknown keywords, invalid bounds and cyclic declarations; object literals compare structurally and string lengths count Unicode code points. This is a registration/validation contract, not a claim that the Composer, durable media, upload/admission or receipt reconciliation already use these new providers.

# Failure and security behavior

- Inspection does not import package code.
- Artifact hashes are verified before the first backend import.
- Configuration validates finite JSON against the package schema; credential values use secret references.
- Activation and removal drain affected work and clean ownership-scoped registrations. Cleanup failures remain visible and block an unsafe success claim.
- Missing or incompatible providers fail with diagnostics; the host does not silently substitute a legacy implementation.

# Known limits

- Pibo does not install arbitrary package dependencies during safe plugin installation. Distributed artifacts must contain their runtime closure and use only supported public peers.
- npm publication is sequential rather than transactional. A failure after one or more packages publish requires an operator to reconcile the immutable published versions before resuming.
- Remote registry policy, signing, and release promotion remain release-process concerns rather than runtime behavior.
- Real-provider and Pibo2 acceptance are not implied by the local source and test traceability in this specification.

# Verification and traceability

Source symbols and named tests are bound through commit `a1ccc8d9c2410720ef6c1c2b13e2dab51e8991cb`. The current Standard inventory contains the deliberate 22-plugin selection. On September 22, the provider-seam and Core/Pi changes passed a focused 55/55 behavioral batch and a targeted neutral-module/public-SDK typecheck. A preceding focused batch passed 70/70 and rebuilt 22 plugin artifacts. Behavioral tests used fresh file-at-a-time TypeScript ESM emit, not a root typecheck or release-compiler pass. Installation testing is explicitly user-skipped; no new installed-candidate or production acceptance is claimed.

The following verification is historical evidence at `c6e3943096bd45158393d59519b525b4365679c7`, not a rerun for the current source:

- TypeScript compilation and Pibo 4 artifact construction.
- The serial F08 source, manifest, runtime, browser, and parity set: 105 tests passed, 0 failed.
- The isolated gateway integration set: 5 tests passed, 0 failed, with process cleanup confirmed.
- The Pi-to-Codex yielded-argument parity and durable Codex binding restart/deletion tests passed without weakening their assertions.
- The Pibo 4 package build completed, and 14 focused package/release tests packed the generated Core, all first-party plugins, Cutover, and Standard; the hermetic release test recorded only generated-directory publish targets and no root `npm publish`.

# Related concepts

- [App Context Composition](/specs/product/app-context.md)
- [Agent Runtime Adapter Contract](/specs/runtime/adapter-contract.md)
- [Authenticated Web Host and Channel](/specs/gateway/web-host-and-channel.md)
- [Session Workspace Lifecycle](/specs/web/session-workspace-lifecycle.md)
- [Pibo 4.0 plugin completion plan](/plans/pibo-4-0-plugin-completion.md)
