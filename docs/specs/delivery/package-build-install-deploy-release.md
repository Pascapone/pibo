---
type: "Specification"
title: "Package, Build, Installation, Deployment, and Release"
description: "Defines the implemented package, build, installation, deployment-preparation, Docker, and release contract and its evidence limits."
tags:
  - "delivery"
  - "package"
  - "release"
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-15T03:35:09Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
  - id: "pibo4-release-boundary"
    resource: "scope:commit 746b990cd861f26d09e4a46be9e0972dadee0b7e"
    title: "Private workspace and split Pibo 4 npm release path"
implementation:
  state: "current"
  baseline_commit: "746b990cd861f26d09e4a46be9e0972dadee0b7e"
  package: "WP-10-DELIVERY-VALIDATION"
  package_parent: "ca8de98aaf1a536006b9e5f0e3a070da1d5070bd"
  source_evidence: "performed"
  focused_test_execution: "performed in Docker: 14 focused Pibo 4 package/release tests passed; historical delivery tests remain separately scoped"
  build_typecheck_package_execution: "performed: generated Minimal-Core, Cutover, 20 plugins, and Standard; independent npm packs and clean Minimal-Core import passed"
  live_external_execution: "unperformed"
traceability:
  commit: "746b990cd861f26d09e4a46be9e0972dadee0b7e"
  requirements:
    - id: "DELIVERY-PACKAGE-001"
      status: "implemented"
      sources:
        - path: "package.json"
          symbol: "scripts.build"
        - path: "package.json"
          symbol: "scripts.workflows:build"
        - path: "package.json"
          symbol: "scripts.web-ui:build"
        - path: "package.json"
          symbol: "scripts.pibo4:packages"
        - path: "package.json"
          symbol: "bin"
        - path: "tsconfig.json"
          symbol: "compilerOptions"
        - path: "tsconfig.json"
          symbol: "include"
        - path: "tsconfig.json"
          symbol: "exclude"
        - path: "packages/workflows/package.json"
          symbol: "scripts.build"
        - path: "packages/workflows/package.json"
          symbol: "main"
        - path: "packages/workflows/package.json"
          symbol: "types"
        - path: "packages/workflows/package.json"
          symbol: "exports"
        - path: "src/apps/chat-ui/vite.config.ts"
          symbol: "export default defineConfig({"
        - path: "src/apps/context-files-ui/vite.config.ts"
          symbol: "export default defineConfig({"
        - path: "scripts/build-pibo4-artifacts.mjs"
        - path: "scripts/build-pibo4-minimal-core.mjs"
        - path: "src/bin/pibo.ts"
          symbol: "await runPiboCli()"
        - path: "src/bin/rg.ts"
          symbol: "const child = spawn"
      tests:
        - path: "test/rg-bin.test.mjs"
          name: "bundled rg wrapper executes ripgrep"
        - path: "test/static-assets.test.mjs"
          name: "built Chat assets use explicit deterministic compression with stable caching"
      public:
        - "npm run build"
        - "npm run pibo4:packages"
        - "pibo and rg development binaries"
      failures:
        - "Any sub-build failure stops the composed command; no partial-output rollback is promised."
        - "Server compilation excludes browser trees; executable entrypoints and generated package builders are explicit."
        - "Node >=24, ES2023/NodeNext server output, Vite browser outputs, and platform-aware npm/npx wrappers."
      confidence: "high"
      follow_up: "Run typecheck/build plus rg/static-asset and Pibo 4 package tests, then retain a build-graph check for the expected private-workspace and generated-package outputs."
    - id: "DELIVERY-PACKAGE-002"
      status: "implemented"
      sources:
        - path: "package.json"
          symbol: "private"
        - path: "package.json"
          symbol: "scripts.prepublishOnly"
        - path: "scripts/build-pibo4-minimal-core.mjs"
          symbol: "releaseVersion"
        - path: "scripts/build-pibo4-artifacts.mjs"
          symbol: "releaseVersion"
        - path: "scripts/release.mjs"
          symbol: "pibo4ReleasePackages"
      tests:
        - path: "test/npm-package-contents.test.mjs"
          name: "repository root refuses direct npm publication"
        - path: "test/npm-package-contents.test.mjs"
          name: "generated Minimal-Core tarball excludes repository and feature implementation surfaces"
        - path: "test/npm-package-contents.test.mjs"
          name: "generated Minimal-Core supports public package imports from its own tarball"
        - path: "test/pibo4-packed-distribution.test.mjs"
          name: "every first-party artifact independently packs with exact identity and self-contained backend"
        - path: "test/pibo4-packed-distribution.test.mjs"
          name: "standard artifact set maps every package to one exact plugin id and version"
        - path: "test/release-script.test.mjs"
          name: "release publishes only generated Minimal-Core, Cutover, plugin, and Standard packages"
      public:
        - "@pasko70/pibo Minimal-Core tarball"
        - "@pasko70/pibo-cutover tarball"
        - "@pasko70/pibo-plugin-* tarballs"
        - "@pasko70/pibo-standard tarball"
      failures:
        - "Reject a non-private repository root, wrong artifact names or versions, duplicate package names, and inconsistent Standard dependency pins before publication."
        - "Publish each immutable package from its generated directory; the sequence is fail-fast but not atomic across npm packages."
        - "Node >=24; no live npm publication, registry signing, or promotion acceptance is claimed."
      confidence: "high"
      follow_up: "Exercise the exact multi-package sequence against a disposable npm-compatible registry before the first production publication."
    - id: "DELIVERY-PACKAGE-003"
      status: "implemented"
      sources:
        - path: "src/setup/cli.ts"
          symbol: "runSetupCli"
        - path: "src/setup/cli.ts"
          symbol: "requireConfirmedApply"
        - path: "src/setup/cli.ts"
          symbol: "validatePublicAuthBoundary"
        - path: "src/setup/cli.ts"
          symbol: "applyOrStageInstallation"
        - path: "src/setup/installation-profiles.ts"
          symbol: "createInstallationPlan"
        - path: "src/setup/installation-profiles.ts"
          symbol: "validateInstallationPlanTargets"
        - path: "src/setup/installation-profiles.ts"
          symbol: "materializeInstallationPlan"
        - path: "src/setup/installation-profiles.ts"
          symbol: "runPendingInstallationActions"
        - path: "src/setup/installation-profiles.ts"
          symbol: "inspectInstallation"
        - path: "src/setup/installation-profiles.ts"
          symbol: "uninstallInstallation"
      tests:
        - path: "test/setup-cli.test.mjs"
          name: "Batteries Included is the default complete profile with a loopback authenticated IDE route"
        - path: "test/setup-cli.test.mjs"
          name: "public apply refuses missing or local-only auth before host mutation"
        - path: "test/setup-cli.test.mjs"
          name: "setup preflights every target before writing and preserves unmanaged files"
        - path: "test/setup-cli.test.mjs"
          name: "profile staging is idempotent and status reports pinned component versions"
        - path: "test/setup-cli.test.mjs"
          name: "profile transition removes obsolete owned resources while preserving workspace data"
        - path: "test/setup-cli.test.mjs"
          name: "uninstall removes only unchanged owned files and preserves data and modified files"
      public:
        - "pibo setup plan|install|status|upgrade|component add|uninstall"
        - "setup installation manifest"
      failures:
        - "Reject unsupported platform, insufficient confirmation, unsafe targets, or public Better Auth misconfiguration before host mutation."
        - "Enforce public-auth boundary and ownership/mode expectations; preserve unmanaged, modified, Pibo Home, and workspace data."
        - "Host apply is Linux-specific; staging/plan behavior remains separately testable."
      confidence: "high"
      follow_up: "Run setup-cli tests, stage both profiles under a temporary root twice, inspect idempotence and modes, then perform a disposable Linux-host apply/upgrade/uninstall acceptance with no production gateway."
    - id: "DELIVERY-PACKAGE-004"
      status: "implemented"
      sources:
        - path: "scripts/deploy-web-dev.sh"
          symbol: "resolve_dev_public_url"
        - path: "scripts/deploy-web-dev.sh"
          symbol: "require_clean_worktree"
        - path: "scripts/deploy-web-dev.sh"
          symbol: "sync_dev_worktree"
        - path: "scripts/deploy-web-dev.sh"
          symbol: "ensure_dev_worktree"
        - path: "scripts/deploy-web-dev.sh"
          symbol: "set -euo pipefail"
        - path: "scripts/deploy-web.sh"
          symbol: "set -euo pipefail"
        - path: "src/gateway/cli.ts"
          symbol: "checkActiveWork"
        - path: "src/gateway/cli.ts"
          symbol: "runGatewayCli"
        - path: "src/gateway/cli.ts"
          symbol: "RESTART_CONFIRMATION_TOKEN"
        - path: "src/gateway/backup.ts"
          symbol: "installBackup"
        - path: "src/gateway/backup.ts"
          symbol: "updateBackup"
        - path: "src/gateway/backup.ts"
          symbol: "getBackupStatus"
        - path: "src/gateway/backup.ts"
          symbol: "removeBackup"
        - path: "Dockerfile"
          symbol: "FROM node:24-slim"
        - path: "Dockerfile"
          symbol: "ENTRYPOINT"
        - path: "Dockerfile"
          symbol: "CMD"
        - path: "docker-compose.yml"
          symbol: "services"
        - path: "docker-compose.yml"
          symbol: "volumes"
      tests:
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with processing sessions"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with active yielded runs"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "exports the exact force confirmation token"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "do not call direct restart, stop, or kill operations"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "print CLI restart instructions"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "keeps hosted dev public URLs in environment configuration"
        - path: "test/setup-cli.test.mjs"
          name: "public apply refuses missing or local-only auth before host mutation"
        - path: "test/setup-cli.test.mjs"
          name: "public apply requires auth.baseURL to match the installation domain"
      public:
        - "scripts/deploy-web-dev.sh"
        - "scripts/deploy-web.sh"
        - "pibo gateway web|dev status|start|restart|doctor"
        - "Dockerfile and docker-compose.yml"
      failures:
        - "Reject dirty/noncanonical dev worktrees and blocked gateway restarts; deploy scripts fail on build/probe errors without direct restart."
        - "Public URL comes from environment; gateway restart uses an exact confirmation token when active work exists; Docker state uses declared volumes."
        - "Deploy scripts and standalone image target Linux shells/containers; Docker behavior has no focused acceptance tests."
      confidence: "high"
      follow_up: "Run restart/deploy tests; in an isolated worker build and smoke the Docker image/Compose config; then validate dev deploy before seeking explicit production deploy approval and exercise only CLI-managed activation."
    - id: "DELIVERY-PACKAGE-005"
      status: "implemented"
      sources:
        - path: "scripts/release.mjs"
          symbol: "parseArgs"
        - path: "scripts/release.mjs"
          symbol: "pibo4ReleasePackages"
        - path: "scripts/release.mjs"
          symbol: "currentGitCommit"
        - path: "scripts/release.mjs"
          symbol: "currentGitTag"
        - path: "scripts/release.mjs"
          symbol: "runInherit"
        - path: "scripts/create-github-release.mjs"
          symbol: "createRelease"
        - path: "scripts/create-github-release.mjs"
          symbol: "ASSET_MAX_BYTES"
        - path: "package.json"
          symbol: "private"
        - path: "package.json"
          symbol: "scripts.release"
        - path: "package.json"
          symbol: "scripts.release:github"
      source_inspected: true
      tests:
        - path: "test/release-script.test.mjs"
          name: "release updates private workspace lock metadata before building versioned artifacts"
        - path: "test/release-script.test.mjs"
          name: "release publishes only generated Minimal-Core, Cutover, plugin, and Standard packages"
        - path: "test/release-semver.test.mjs"
          name: "release dry-run accepts valid SemVer versions"
        - path: "test/release-semver.test.mjs"
          name: "release rejects invalid SemVer before release work"
        - path: "test/create-github-release.test.mjs"
          name: "uploads a valid asset after creating a new release"
        - path: "test/create-github-release.test.mjs"
          name: "keeps an existing release unchanged"
      public:
        - "npm run release"
        - "npm run release:github"
        - "generated Pibo 4 npm packages"
      failures:
        - "Reject invalid SemVer, a non-private root, mismatched package identities or versions, inconsistent Standard pins, npm failures, or a mismatched GitHub tag."
        - "Multi-package publication is sequential and may require explicit reconciliation after a partial publish."
        - "No live GitHub/npm publication or Windows acceptance was performed."
      confidence: "high"
      follow_up: "Exercise the exact 23-package sequence against a disposable registry and document partial-publish recovery before production publication."
---
# Package, Build, Installation, Deployment, and Release

## Authority and evidence boundary

- Stable concept: `SPC-DEL-001`.
- Current-behavior authority: Pibo 4 release-boundary commit `746b990cd861f26d09e4a46be9e0972dadee0b7e`, retaining the earlier delivery audit where unchanged.
- Raw-package parent: accepted commit `ca8de98aaf1a536006b9e5f0e3a070da1d5070bd`.
- Source and named-test locators identify regular upstream/dev refresh blobs. Executed package checks prove candidate/parent parity only; they do not prove live or external behavior.
- This specification contains implemented current behavior only. Follow-ups and gaps are non-normative.

## Scope

### In scope

- The private repository build workspace, pibo and rg development binaries, server/workflow/web build graph, and generated Pibo 4 Core/Cutover/plugin/Standard package artifacts.
- Supported setup profile planning/apply/status/upgrade/component-add/uninstall and managed gateway web/dev lifecycle commands.
- Standalone Dockerfile/Compose behavior, host deploy scripts, release version bump/build/package/publish orchestration, and GitHub Release asset upload.

### Out of scope

- Feature-level runtime, auth, workflow, or web UI behavior supplied inside artifacts.
- Workflow validation semantics, test-suite selection, or system acceptance; SPC-VAL-001 owns validation contracts.
- Upstream Git branching, tagging, pushing, release approval, Marketplace processing, or production approval decisions.
- Docker compute workers; the root standalone Docker runtime is a separate delivery surface.

## Current behavior

### Public surfaces

- Generated `@pasko70/pibo` Minimal-Core, `@pasko70/pibo-cutover`, `@pasko70/pibo-plugin-*`, and `@pasko70/pibo-standard` packages.
- npm run build|typecheck|pibo4:packages|release.
- pibo setup and pibo gateway web|dev status|start|restart|doctor.
- Dockerfile, docker-compose.yml, deploy-web-dev.sh, deploy-web.sh, release.mjs, and create-github-release.mjs.

### State

- Builds emit the private workspace outputs plus generated Pibo 4 package directories. The broad root `dist/` tree is not the npm package boundary. Minimal-Core contains only its explicit public modules and declaration closure; first-party backends/browser entries, Cutover, and Standard remain separately packable artifacts.
- Setup records a private schemaVersion-1 manifest with owned-file digests, modes, components, and action fingerprints.
- Gateway web and dev use distinct service names, ports, and default Pibo Homes; production restart inspects active runtime and yielded-run state.
- Docker Compose persists /root/.pibo and /root/.browser-use; release artifacts live under dist/apps/vscode-artifacts.

### Lifecycle

- Root build compiles the private workflow workspace, server TypeScript, Chat and Context Vite apps, and executable development/deployment outputs. It also builds the split plugin artifacts; the release wrapper then builds Minimal-Core with the requested release version and verifies all generated manifests before publication.
- Setup plans before mutation, requires --apply --yes and root on Linux, preflights every destination, writes atomically, fingerprints completed actions, and preserves modified files/data on transitions and uninstall.
- Deploy-dev syncs a clean canonical dev worktree, builds, and probes a configured public URL without restarting. Deploy-prod builds and refreshes the stable backup without restarting. Ordering and production approval are operator policy, not enforced between the two scripts.
- Release writes the private workspace and lock versions, passes that version into generated Core/Cutover/Standard manifests, builds all package directories, and optionally publishes Core, Cutover, each listed plugin, and Standard in dependency order. It never invokes a bare root `npm publish`, creates/pushes commits or tags, or claims atomic multi-package publication. GitHub release creation remains conditional on the expected existing tag.

### Failure

- Build, pack, setup, deploy, backup, and release scripts fail on command errors; setup refuses unmanaged/modified target overwrites and incomplete public-auth configuration.
- Production restart blocks on unreachable/ambiguous/wrong-mode status, processing, streaming, queued messages, stale telemetry, or active yielded runs unless the exact force confirmation token is supplied.
- GitHub Release creation is tag-idempotent; invalid local assets fail before any GitHub request, upload failures remain explicit, and an existing release is left unchanged rather than repaired implicitly.

### Security

- Node >=24, a private repository marker plus an executable Root-publish guard, explicit generated-package file lists, exact Standard pins, private setup files, and public Better Auth validation constrain delivery.
- Deploy scripts never restart directly; the gateway CLI owns activation safety.
- GitHub App credentials remain external and the uploaded asset is capped at 64 MiB; no signing or checksum manifest is produced.
- The Dockerfile downloads uv through a remote shell and runs npm install rather than npm ci; no focused Docker supply-chain test exists.

### Platform and compatibility

- The private workspace and generated Minimal-Core require Node >=24. Server TypeScript targets ES2023/NodeNext and excludes browser trees from the server compiler.
- Vite apps build from separate roots; package/release scripts select cmd.exe npm.cmd/npx.cmd on Windows where implemented.
- Host setup apply supports Linux only; plans warn that native Windows is unsupported. Gateway management has a Windows process-manager fallback.
- Standalone Docker uses node:24-slim and installs x64/arm64-independent Debian packages, while setup's code-server download supports only x64 and arm64.

## Requirements and invariants

## Requirement: DELIVERY-PACKAGE-001: Current implemented contract

The delivery system MUST build the private workflow workspace, server TypeScript, Chat and Context web apps, executable pibo/rg development binaries, and the generated Pibo 4 Core/Cutover/plugin/Standard package directories from explicit roots.

### Acceptance and boundaries

- Exact source evidence: `package.json` — `scripts.build`, `scripts.workflows:build`, `scripts.web-ui:build`, `scripts.pibo4:packages`, and `bin`; `tsconfig.json` — `compilerOptions`, `include`, and `exclude`; `packages/workflows/package.json` — `scripts.build`, `main`, `types`, and `exports`; `src/apps/chat-ui/vite.config.ts` and `src/apps/context-files-ui/vite.config.ts` — Vite roots; `scripts/build-pibo4-artifacts.mjs` and `scripts/build-pibo4-minimal-core.mjs` — generated package roots; `src/bin/pibo.ts` and `src/bin/rg.ts` — development entrypoints
- Exact named tests: `test/rg-bin.test.mjs` — “bundled rg wrapper executes ripgrep”; `test/static-assets.test.mjs` — “built Chat assets use explicit deterministic compression with stable caching”; `test/pibo4-packed-distribution.test.mjs` — generated package boundaries
- Public surfaces: `npm run build`; `npm run pibo4:packages`; private-workspace `pibo` and `rg` development binaries
- Failure boundary: Any sub-build failure stops the composed command; no partial-output rollback is promised.
- Security boundary: Server compilation excludes browser trees; executable entrypoints and generated package roots are explicit.
- Platform and compatibility boundary: Node >=24, ES2023/NodeNext server output, Vite browser outputs, and platform-aware npm/npx wrappers.
- Confidence: **high**
- Evidence gap and follow-up: Run typecheck/build plus rg/static-asset and Pibo 4 package tests; keep private-workspace outputs distinct from generated npm artifacts.

#### Later validation commands

```text
npm run typecheck && npm run build
node scripts/run-test-suite.mjs test/rg-bin.test.mjs test/static-assets.test.mjs
```


## Requirement: DELIVERY-PACKAGE-002: Current implemented contract

The delivery system MUST mark the repository root private, reject direct Root publication through `prepublishOnly`, and build the npm distribution as separate generated packages: Minimal-Core, Cutover, every plugin listed by Standard, and Standard itself. It MUST verify each artifact identity and version plus all Standard pins before publication. The broad root `dist/` tree MUST NOT serve as npm delivery evidence.

### Acceptance and boundaries

- Exact source evidence: `package.json` — `private` and `scripts.prepublishOnly`; `scripts/build-pibo4-minimal-core.mjs` — `releaseVersion`; `scripts/build-pibo4-artifacts.mjs` — `releaseVersion`; `scripts/release.mjs` — `pibo4ReleasePackages`
- Exact named tests: `test/npm-package-contents.test.mjs` — “repository root refuses direct npm publication”, “generated Minimal-Core tarball excludes repository and feature implementation surfaces”, and “generated Minimal-Core supports public package imports from its own tarball”; `test/pibo4-packed-distribution.test.mjs` — independent plugin, Standard, and Cutover packs; `test/release-script.test.mjs` — “release publishes only generated Minimal-Core, Cutover, plugin, and Standard packages”
- Public surfaces: `@pasko70/pibo`; `@pasko70/pibo-cutover`; `@pasko70/pibo-plugin-*`; `@pasko70/pibo-standard`
- Failure boundary: Reject a non-private root, missing or mismatched artifacts, duplicate package names, or inconsistent Standard pins before the first publication.
- Security boundary: The root prepublish guard rejects normal direct publication. Minimal-Core has an explicit package file list and excludes first-party feature implementations; each plugin ships its self-contained backend/browser closure.
- Platform and compatibility boundary: Node >=24. Multi-package npm publication is sequential and fail-fast, not atomic.
- Confidence: **high**
- Evidence and follow-up: The generated Minimal-Core installed and imported in a clean consumer; all 20 plugins, Cutover, and Standard packed separately. The release wrapper's hermetic test recorded only generated-directory publish commands. No live npm publication was performed; exercise the same sequence against a disposable registry before production.

#### Later validation commands

```text
npm run pibo4:packages
node --test --test-concurrency=1 test/npm-package-contents.test.mjs test/pibo4-packed-distribution.test.mjs test/release-script.test.mjs
```


## Requirement: DELIVERY-PACKAGE-003: Current implemented contract

The delivery system MUST plan, stage/apply, inspect, upgrade, add components, and uninstall batteries-included or vanilla Linux host profiles with target preflight, atomic owned-file writes, action fingerprints, public-auth checks, and preservation of modified files, Pibo Home, and workspaces.

### Acceptance and boundaries

- Exact source evidence: `src/setup/cli.ts:871` — `runSetupCli`; `src/setup/cli.ts:781` — `requireConfirmedApply`; `src/setup/cli.ts:788` — `validatePublicAuthBoundary`; `src/setup/cli.ts:811` — `applyOrStageInstallation`; `src/setup/installation-profiles.ts:258` — `createInstallationPlan`; `src/setup/installation-profiles.ts:394` — `validateInstallationPlanTargets`; `src/setup/installation-profiles.ts:408` — `materializeInstallationPlan`; `src/setup/installation-profiles.ts:493` — `runPendingInstallationActions`; `src/setup/installation-profiles.ts:520` — `inspectInstallation`; `src/setup/installation-profiles.ts:544` — `uninstallInstallation`; `docs/project/operations/install-user-host.md:1` — `# Install Pibo as a User Host`; `docs/project/operations/install-developer-host.md:1` — `# Install Pibo as a Developer Host`; `docs/project/operations/upgrade-user-to-developer-host.md:1` — `# Upgrade a User Host to a Developer Host`
- Exact named tests: `test/setup-cli.test.mjs:144` — “Batteries Included is the default complete profile with a loopback authenticated IDE route”; `test/setup-cli.test.mjs:200` — “public apply refuses missing or local-only auth before host mutation”; `test/setup-cli.test.mjs:234` — “setup preflights every target before writing and preserves unmanaged files”; `test/setup-cli.test.mjs:250` — “profile staging is idempotent and status reports pinned component versions”; `test/setup-cli.test.mjs:323` — “profile transition removes obsolete owned resources while preserving workspace data”; `test/setup-cli.test.mjs:439` — “uninstall removes only unchanged owned files and preserves data and modified files”
- Public surfaces: `pibo setup plan|install|status|upgrade|component add|uninstall`; `setup installation manifest`
- Failure boundary: Reject unsupported platform, insufficient confirmation, unsafe targets, or public Better Auth misconfiguration before host mutation.
- Security boundary: Enforce public-auth boundary and ownership/mode expectations; preserve unmanaged, modified, Pibo Home, and workspace data.
- Platform and compatibility boundary: Host apply is Linux-specific; staging/plan behavior remains separately testable.
- Confidence: **high**
- Evidence gap and follow-up: Run setup-cli tests, stage both profiles under a temporary root twice, inspect idempotence and modes, then perform a disposable Linux-host apply/upgrade/uninstall acceptance with no production gateway.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/setup-cli.test.mjs
```


## Requirement: DELIVERY-PACKAGE-004: Current implemented contract

The delivery system MUST keep dev and production deploys as separate build-only activation preparations: dev syncs a clean canonical branch/worktree and probes an environment-provided URL, production refreshes the stable backup, neither restarts directly, and production restart remains guarded by gateway active-work checks; standalone Docker remains a separate source-inspected surface.

### Acceptance and boundaries

- Exact source evidence: `scripts/deploy-web-dev.sh:13` — `resolve_dev_public_url`; `scripts/deploy-web-dev.sh:40` — `require_clean_worktree`; `scripts/deploy-web-dev.sh:49` — `sync_dev_worktree`; `scripts/deploy-web-dev.sh:69` — `ensure_dev_worktree`; `scripts/deploy-web-dev.sh:2` — `set -euo pipefail`; `scripts/deploy-web.sh:2` — `set -euo pipefail`; `src/gateway/cli.ts:266` — `checkActiveWork`; `src/gateway/cli.ts:422` — `runGatewayCli`; `src/gateway/cli.ts:11` — `RESTART_CONFIRMATION_TOKEN`; `src/gateway/backup.ts:28` — `installBackup`; `src/gateway/backup.ts:77` — `updateBackup`; `src/gateway/backup.ts:83` — `getBackupStatus`; `src/gateway/backup.ts:92` — `removeBackup`; `Dockerfile:1` — `FROM node:24-slim`; `Dockerfile:54` — `ENTRYPOINT`; `Dockerfile:55` — `CMD`; `docker-compose.yml:3` — `services`; `docker-compose.yml:17` — `volumes`
- Exact named tests: `test/gateway-restart-safety.test.mjs` — processing, yielded-run, confirmation-token, no-direct-restart, CLI-instruction, and hosted-dev-URL checks; `test/setup-cli.test.mjs` — “public apply refuses missing or local-only auth before host mutation” and “public apply requires auth.baseURL to match the installation domain”
- Public surfaces: `scripts/deploy-web-dev.sh`; `scripts/deploy-web.sh`; `pibo gateway web|dev status|start|restart|doctor`; `Dockerfile and docker-compose.yml`
- Failure boundary: Reject dirty/noncanonical dev worktrees and blocked gateway restarts; deploy scripts fail on build/probe errors without direct restart.
- Security boundary: Public URL comes from environment; gateway restart uses an exact confirmation token when active work exists; Docker state uses declared volumes.
- Platform and compatibility boundary: Deploy scripts and standalone image target Linux shells/containers; Docker behavior has no focused acceptance tests.
- Confidence: **high**
- Evidence gap and follow-up: Run restart/deploy tests; in an isolated worker build and smoke the Docker image/Compose config; then validate dev deploy before seeking explicit production deploy approval and exercise only CLI-managed activation.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/gateway-restart-safety.test.mjs
docker build -t pibo-delivery-validation:baseline . && docker compose config
```


## Requirement: DELIVERY-PACKAGE-005: Current implemented contract

The delivery system MUST validate SemVer, update the private workspace and lock versions, build versioned Pibo 4 package artifacts, verify the complete package set, optionally publish only those generated directories, and create a GitHub Release only when HEAD already has the expected tag. It MUST NOT publish the repository root or create/push commits or tags.

### Acceptance and boundaries

- Exact source evidence: `scripts/release.mjs` — `parseArgs`, `pibo4ReleasePackages`, `currentGitCommit`, `currentGitTag`, and `runInherit`; `scripts/create-github-release.mjs` — `createRelease`, `preflightReleaseAsset`, and `ASSET_MAX_BYTES`; `package.json` — `private`, `version`, `scripts.release`, and `scripts.release:github`
- Named tests: `test/release-script.test.mjs` — workspace/lock version update and generated-directory publish sequence; `test/release-semver.test.mjs` — accepted and rejected SemVer; `test/create-github-release.test.mjs` — asset preflight, upload, and existing-release behavior
- Public surfaces: `npm run release`; `npm run release:github`; generated Pibo 4 npm packages; optional GitHub Release asset
- Failure boundary: Reject invalid SemVer, non-private root, artifact identity/version/pin errors, npm failures, mismatched tag, or invalid GitHub assets. A failed multi-package publish may leave an immutable prefix already published and requires explicit reconciliation.
- Security boundary: The root `prepublishOnly` guard rejects normal direct npm publication; `private: true` marks the workspace intent. Generated scoped packages are published with public access. GitHub credentials remain external and assets are not signed or checksummed.
- Platform and compatibility boundary: Node release scripts and external npm/git/GitHub CLIs; no live npm/GitHub publication or Windows acceptance was performed.
- Confidence: **high**
- Evidence gap and follow-up: Exercise the exact 23-package publish order against a disposable registry, then document resumability for a failure after a partial publish.

#### Later validation commands

```text
node scripts/release.mjs --version 4.0.0-beta.1 --dry-run
node --test --test-concurrency=1 test/release-script.test.mjs test/release-semver.test.mjs
```


## Interfaces and ownership

### Owned capability IDs

- `pibo.product.package-api`
- `pibo.operator.gateway-lifecycle`
- `pibo.delivery.build`
- `pibo.delivery.docker-deploy`
- `pibo.delivery.release`

### Public surfaces

- Generated `@pasko70/pibo` Minimal-Core, `@pasko70/pibo-cutover`, `@pasko70/pibo-plugin-*`, and `@pasko70/pibo-standard` packages.
- npm run build|typecheck|pibo4:packages|release.
- pibo setup and pibo gateway web|dev status|start|restart|doctor.
- Dockerfile, docker-compose.yml, deploy-web-dev.sh, deploy-web.sh, release.mjs, and create-github-release.mjs.

### Linked owners

- [SPC-ORCH-005](/specs/orchestration/workflow-framework-runtime-store.md) — linked owner; this specification does not duplicate its contract.
- [SPC-SEC-003](/specs/security/gateway-admission-and-restart.md) — linked owner; this specification does not duplicate its contract.
- [SPC-VSC-002](/specs/vscode/sidecar-webview-and-delivery.md) — linked owner; this specification does not duplicate its contract.
## Evidence accounting

- Requirements: 5; confidence: 5 high, 0 medium, 0 low.
- Source-only requirements: 1; requirements with named tests: 4.
- Exact source locators: 79; exact named-test locators: 19.
- Reconciled stale-claim rejections: 8; preserved evidence gaps: 5.

| Evidence class | Rebound status | Boundary |
| --- | --- | --- |
| source inspection | performed | Package/build/config, setup, gateway, Docker, deploy, release, VSIX, and named test files were inspected. |
| focused tests | performed | The Pibo 4 packaging review passed 14/14 package/release tests in the isolated Docker worker. Earlier setup, gateway, and broad-suite results remain historical evidence for their own commits. |
| build package checks | performed-partial | Minimal-Core, Cutover, 20 plugins, and Standard were generated. The Core installed/imported in a clean consumer; all plugins plus Cutover and Standard packed independently. No live registry publication, VSIX packaging, or Docker image build was run for this correction. |
| local real path pty headful browser validation | not-applicable | The canonical target does not require this evidence class; UI acceptance belongs to dependent targets. |
| external provider pibo2 acceptance | unperformed | No npm, GitHub Release, Marketplace, external host, or Pibo2 acceptance was run. |

The rebound statuses describe the input audit before this package's deterministic execution. The external and real-path gaps below remain unverified regardless of candidate/parent test parity.

## Reconciled stale-claim rejections

12. Reject the old Root-pack delivery claim: the repository root is private and its broad `dist/` output is not `@pasko70/pibo` npm-release evidence.
13. Reject claims that root build packages the extension host or VSIX; extension delivery is retired from the current Pibo 4 package contract.
14. Reject claims that every workspace dependency is a published Core dependency. Minimal-Core is generated with its own explicit file list and no package dependencies; Standard pins Core and each plugin exactly.
15. Reject managed gateway stop-command claims; web/dev expose status, start, restart, and doctor only.
16. Reject code-enforced dev-before-production deployment; AGENTS/operator policy requires it, but deploy-web.sh can run independently.
17. Reject the historical two-manifest/VSIX version claim. The current release script updates the private workspace and root lock versions, then passes the requested version to generated Core, Cutover, and Standard manifests.
18. Reject automatic tags, pushes, Marketplace uploads, signing, or release-asset repair claims.
19. Reject claims that Docker runtime behavior was accepted. Release orchestration now has focused hermetic tests, but no live registry or deployment mutation was performed.

## Evidence gaps and non-normative follow-ups

8. No live registry test proves production npm permissions, dist-tags, provenance, or partial-publish recovery; local tests cover generated tarballs and exact publish targets only.
9. No focused test builds/runs Dockerfile or Compose, checks entrypoint auth behavior, or verifies exposed/published ports.
10. Release orchestration and GitHub asset handling have focused hermetic tests, but no npm/GitHub/Marketplace mutation was performed.
11. Production deployment approval and dev-first ordering remain external process gates.
12. The production backup implementation rebuilds a broad source copy under ~/.pibo/stable and shares ~/.pibo by symlink; no focused backup test is cited.

These gaps do not define intended behavior. Any implementation change requires a separate plan and later source/test reconciliation.

## Verification and traceability

- Current package/release requirements trace through `746b990cd861f26d09e4a46be9e0972dadee0b7e`; unchanged delivery requirements retain their earlier source locators.
- Named tests are identified by exact test names. Source-only requirements set `source_inspected: true` and carry a concrete follow-up.
- Deterministic wrappers, source guards, archive checks, and accelerated fixtures are bounded evidence. They are not substitutes for headful VS Code, real workspace activation, real PTY, live browser/CDP, provider, controller gateway, Docker runtime, release publication, deployment, or Pibo2 acceptance.
- Package execution results belong to the implementation audit, not to the normative current-behavior claim. Final acceptance at `7ec71c2cca2108423002be0e7330d2a20c4c5b67` added a passing empty-directory `npm install --omit=dev` smoke without rebinding unchanged package source traceability.

## Related concepts

- [SPC-ORCH-005](/specs/orchestration/workflow-framework-runtime-store.md) — linked owner; this specification does not duplicate its contract.
- [SPC-SEC-003](/specs/security/gateway-admission-and-restart.md) — linked owner; this specification does not duplicate its contract.
- [SPC-VSC-002](/specs/vscode/sidecar-webview-and-delivery.md) — linked owner; this specification does not duplicate its contract.
