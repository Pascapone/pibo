# Spec: Package Build and Distribution

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** `docs/specs/capabilities/operator-cli-discovery-and-dispatch.md`, `docs/specs/capabilities/chat-web-static-shell-and-pwa-assets.md`, `docs/specs/capabilities/context-files.md`

## Why

Pibo is installed and operated as an npm package, but most existing specs focus on runtime capabilities after the package is already running. The package boundary itself is a product contract: it defines the Node version, installed binary, compiled TypeScript output, bundled web assets, public module exports, and validation commands that operators and release workflows rely on.

A broken package build can make otherwise-correct capabilities unavailable. The build and distribution behavior therefore needs a focused spec that ties the current source layout to the installable artifact.

## Goal

Pibo MUST build, validate, and package a Node 24+ npm artifact that exposes the `pibo` CLI, public TypeScript module exports, and built web app assets from the current source tree.

## Background / Current State

`package.json` declares the package as `@pasko70/pibo`, ESM-only, Node `>=24`, and installs the `pibo` binary from `dist/bin/pibo.js`. The root TypeScript build compiles `src/**/*.ts` into `dist/` but excludes the Vite web UI source trees. Separate Vite builds write Chat UI assets to `dist/apps/chat-ui` and Context Files UI assets to `dist/apps/context-files-ui`.

The package `files` list includes `dist`, selected built-in skill resources, `README.md`, and `src/mcp/LICENSE.mcp-cli`. `prepack` runs the full build, so packaging from source refreshes the compiled artifact first.

## Scope

### In Scope

- The npm package metadata that affects install and runtime compatibility.
- Root TypeScript compilation into `dist/`.
- Chat UI and Context Files UI Vite builds into their expected dist app directories.
- The installed `pibo` binary entrypoint.
- Public module exports from `src/index.ts`.
- Validation commands exposed through package scripts.
- The files intentionally included in npm package artifacts.

### Out of Scope

- Deployment of built web assets to host gateways — covered by Web Deployment Scripts.
- Runtime behavior of individual CLI commands — covered by CLI and capability-specific specs.
- Browser behavior inside built web apps — covered by Chat Web and Context Files specs.
- Publishing to npm registries, version bumping, signing, or release approval workflow.
- Dependency upgrade policy beyond the currently declared Node engine and package scripts.

## Requirements

### Requirement: Package identity and runtime compatibility are explicit

The package MUST declare the installable package name, ESM module mode, Node engine floor, and installed binary path in package metadata.

#### Current

`package.json` declares `name: "@pasko70/pibo"`, `type: "module"`, `engines.node: ">=24"`, and `bin.pibo: "dist/bin/pibo.js"`.

#### Target

Consumers can install the package and know that Pibo requires Node 24 or newer, runs as ESM, and exposes the `pibo` command from the compiled dist tree.

#### Acceptance

- `package.json` contains the package name, ESM type, Node `>=24` engine, and `pibo` bin mapping.
- After a successful build, `dist/bin/pibo.js` exists and is executable through the package binary mapping.

#### Scenario: Installed binary resolves to compiled CLI

- GIVEN the package has been built
- WHEN npm installs or links the package
- THEN the `pibo` binary resolves to `dist/bin/pibo.js`
- AND that entrypoint invokes the shared CLI runner.

### Requirement: Root build compiles server and CLI TypeScript only

The root TypeScript build MUST compile Node-side TypeScript from `src/` into `dist/` and MUST not compile the Vite web UI source trees through the root `tsconfig.json`.

#### Current

`tsconfig.json` uses `rootDir: "src"`, `outDir: "dist"`, strict NodeNext settings, includes `src/**/*.ts`, and excludes `src/apps/chat-ui/**` plus `src/apps/context-files-ui/**`.

#### Target

Root compilation emits Node-side runtime, CLI, plugin, gateway, and service modules without mixing frontend build outputs into TypeScript compiler output.

#### Acceptance

- `npm run build` runs `tsc -p tsconfig.json` before web UI builds.
- Root `tsconfig.json` excludes both Vite UI source directories.
- TypeScript strict mode remains enabled for root source.

#### Scenario: Frontend source is built by Vite, not root TSC

- GIVEN a frontend file exists under `src/apps/chat-ui/`
- WHEN the root TypeScript project compiles
- THEN that frontend source is not part of the root TypeScript project
- AND the Chat UI build remains responsible for its production assets.

### Requirement: Web UI builds emit package-local app assets

The package build MUST create production assets for each registered web UI under the dist app directory expected by the web host.

#### Current

`npm run web-ui:build` runs `chat-ui:build` and `context-files-ui:build`. The Chat UI Vite config uses base `/apps/chat/` and writes `../../../dist/apps/chat-ui`. The Context Files UI Vite config uses base `/apps/context-files/` and writes `../../../dist/apps/context-files-ui`.

#### Target

A built package contains app assets under stable paths that same-origin web host code can serve without rebuilding at runtime.

#### Acceptance

- `npm run chat-ui:build` emits Chat UI assets under `dist/apps/chat-ui`.
- `npm run context-files-ui:build` emits Context Files UI assets under `dist/apps/context-files-ui`.
- `npm run web-ui:build` builds both UIs.
- `npm run build` includes `web-ui:build` after root TypeScript compilation.

#### Scenario: Full build prepares both web apps

- GIVEN a clean checkout with dependencies installed
- WHEN an operator runs `npm run build`
- THEN the root TypeScript output exists under `dist/`
- AND Chat UI assets exist under `dist/apps/chat-ui`
- AND Context Files UI assets exist under `dist/apps/context-files-ui`.

### Requirement: Validation scripts cover build, tests, and type-only checks

The package MUST provide script-level validation commands that agents and operators can run before installing or deploying changes.

#### Current

`npm test` runs `npm run build && node --test test/*.test.mjs`. `npm run typecheck` runs root TypeScript checks plus Chat UI and Context Files UI typechecks without emitting files. `npm run clean` removes `dist`.

#### Target

Validation commands give clear pass/fail signals for compile output, Node tests, and type-only checks across root and web UI projects.

#### Acceptance

- `npm test` performs a full build before running Node tests.
- `npm run typecheck` checks root, Chat UI, and Context Files UI TypeScript without emitting files.
- `npm run clean` removes generated dist output without touching source or local stores.

#### Scenario: Typecheck does not emit artifacts

- GIVEN source files are present and dependencies are installed
- WHEN an operator runs `npm run typecheck`
- THEN root, Chat UI, and Context Files UI TypeScript projects are checked
- AND no dist output is required as a side effect.

### Requirement: Package artifacts include runtime assets and exclude source-only bulk

The npm package artifact MUST include the compiled runtime and required shipped resources, while avoiding an implicit full repository publish.

#### Current

`package.json` limits package files to `dist`, built-in Pi agent harness skill files, `README.md`, and `src/mcp/LICENSE.mcp-cli`. `prepack` runs `npm run build`.

#### Target

Packaging from source refreshes `dist/` and includes only the compiled runtime plus intentionally shipped resource files.

#### Acceptance

- `prepack` runs the full build before package packing.
- The package `files` allowlist includes `dist`.
- Built-in skill resources required by default profiles are included explicitly.
- The MCP CLI license file remains included for redistributed MCP-derived code.

#### Scenario: Pack from source refreshes the artifact

- GIVEN dependencies are installed in the source checkout
- WHEN npm prepares a package through the `prepack` lifecycle
- THEN Pibo runs the full build
- AND the resulting package includes the new `dist` output and declared resource files.

### Requirement: Public module exports expose product extension boundaries

The package MUST export stable product-boundary APIs for embedding Pibo, registering plugins, creating web apps, running gateways, creating runtimes, using session stores, and selecting supported tools.

#### Current

`src/index.ts` re-exports plugin factory functions, plugin registry types, Chat Web app creation, Better Auth service creation, runtime helpers, session router/store types, reliability and signal stores, gateway server/client functions, local routed TUI helpers, web channel types, subagent helpers, core event/session types, config helpers, and runtime tool exports.

#### Target

Consumers importing the package can integrate with Pibo through explicit product APIs instead of reaching into private source paths.

#### Acceptance

- Public exports include plugin creation and registry APIs.
- Public exports include runtime creation and profile inspection APIs.
- Public exports include Pibo Session routing, store, and event types.
- Public exports include gateway, web channel, local routed TUI, subagent, config, reliability, signal, and runtime tool APIs that are intentionally public.

#### Scenario: Embedding code imports from package root

- GIVEN an integration wants to create a custom Pibo runtime or plugin registry
- WHEN it imports from the package root
- THEN it can access the exported product-boundary APIs without importing from deep `src/` paths.

## Edge Cases

- A package built without running `web-ui:build` is incomplete for same-origin web apps even if the CLI starts.
- A root `tsconfig.json` change that includes frontend Vite source can create duplicate or invalid frontend output under `dist/`.
- A package `files` change that drops built-in skill resources can make the default profile incomplete after install.
- A package `files` change that drops `src/mcp/LICENSE.mcp-cli` can lose required license attribution.
- Running `npm run start` before `npm run build` may fail because it executes the compiled `dist/bin/pibo.js` entrypoint.

## Constraints

- **Compatibility:** The package currently targets Node.js 24 or newer and ESM module loading.
- **Security / Privacy:** Package builds MUST NOT include local `.pibo/` state, credentials, worktrees, or runtime session data.
- **Performance:** Build scripts SHOULD keep frontend and backend compilation separate so agents can run narrower checks when full packaging is unnecessary.
- **Dependencies:** Build and validation commands require npm dependencies, TypeScript, Vite, and the declared frontend toolchain.

## Success Criteria

- [ ] SC-001: `npm run build` emits root runtime output and both web UI dist directories.
- [ ] SC-002: `npm test` builds first and then runs the Node test suite.
- [ ] SC-003: `npm run typecheck` checks root and both web UI TypeScript projects without emitting files.
- [ ] SC-004: `npm pack --dry-run` shows `dist`, declared built-in skill resources, `README.md`, and `src/mcp/LICENSE.mcp-cli`, and does not include local runtime stores.
- [ ] SC-005: The installed or linked `pibo` command resolves to `dist/bin/pibo.js`.
- [ ] SC-006: Public package-root exports cover the supported extension and embedding boundaries without requiring deep imports.

## Assumptions and Open Questions

### Assumptions

- The installable package should remain compiled JavaScript plus selected resources, not a source-distributed TypeScript package.
- Chat UI and Context Files UI are the only web UI bundles currently required by the package build.
- The package root export list in `src/index.ts` is the intended public API surface unless a future API stability policy narrows it.

### Open Questions

- Should release validation require `npm pack --dry-run` or an installed-package smoke test in addition to `npm test`?
- Should the package artifact include generated type declaration files in the future, or is JavaScript-only distribution sufficient for current consumers?
- Should public package-root exports be versioned with explicit stability tiers?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Package identity and runtime compatibility are explicit | Installed binary resolves to compiled CLI | `package.json`, `src/bin/pibo.ts` | Draft |
| REQ-002 Root build compiles server and CLI TypeScript only | Frontend source is built by Vite, not root TSC | `tsconfig.json`, `package.json` | Draft |
| REQ-003 Web UI builds emit package-local app assets | Full build prepares both web apps | `package.json`, Vite configs | Draft |
| REQ-004 Validation scripts cover build, tests, and type-only checks | Typecheck does not emit artifacts | `package.json`, UI tsconfigs | Draft |
| REQ-005 Package artifacts include runtime assets and exclude source-only bulk | Pack from source refreshes the artifact | `package.json` | Draft |
| REQ-006 Public module exports expose product extension boundaries | Embedding code imports from package root | `src/index.ts` | Draft |

## Verification Basis

This spec is based on the current code and package metadata in:

- `package.json`
- `tsconfig.json`
- `src/bin/pibo.ts`
- `src/index.ts`
- `src/apps/chat-ui/vite.config.ts`
- `src/apps/context-files-ui/vite.config.ts`
