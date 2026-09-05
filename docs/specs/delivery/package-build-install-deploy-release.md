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
  at: "2026-09-05T10:02:49Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-10-DELIVERY-VALIDATION"
  package_parent: "ca8de98aaf1a536006b9e5f0e3a070da1d5070bd"
  source_evidence: "performed"
  focused_test_execution: "performed in Docker: package/release tests passed within the affected and full suites"
  build_typecheck_package_execution: "performed: build, typecheck, npm pack, extracted-archive inspection, and clean npm install --omit=dev passed"
  live_external_execution: "unperformed"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
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
          symbol: "scripts.vscode:webview:build"
        - path: "package.json"
          symbol: "scripts.vscode:package"
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
        - path: "src/apps/chat-vscode/extension/webview/vite.config.ts"
          symbol: "export default defineConfig({"
        - path: "src/bin/pibo.ts"
          symbol: "await runPiboCli()"
        - path: "src/bin/rg.ts"
          symbol: "const child = spawn"
      tests:
        - path: "test/rg-bin.test.mjs"
          name: "bundled rg wrapper executes ripgrep"
        - path: "test/static-assets.test.mjs"
          name: "built Chat and VS Code assets use explicit deterministic compression with stable caching"
      public:
        - "npm run build"
        - "npm run vscode:package"
        - "pibo and rg binaries"
      failures:
        - "Any sub-build failure stops the composed command; no partial-output rollback is promised."
        - "Server compilation excludes browser and extension trees; executable entrypoints are explicit."
        - "Node >=24, ES2023/NodeNext server output, Vite browser outputs, and platform-aware npm/npx wrappers."
      confidence: "high"
      follow_up: "Run typecheck/build plus rg/static-asset tests, then add a build-graph test asserting expected outputs and the intentional absence of extension.cjs/VSIX from root build alone."
    - id: "DELIVERY-PACKAGE-002"
      status: "implemented"
      sources:
        - path: "package.json"
          symbol: "files"
        - path: "package.json"
          symbol: "dependencies"
        - path: "package.json"
          symbol: "scripts.prepack"
        - path: "package.json"
          symbol: "scripts.postpack"
        - path: "package.json"
          symbol: "engines"
        - path: "package-lock.json"
          symbol: "lockfileVersion"
        - path: "package-lock.json"
          symbol: "packages"
        - path: "scripts/package-shrinkwrap.mjs"
          symbol: "preparePackageShrinkwrap"
        - path: "scripts/package-shrinkwrap.mjs"
          symbol: "cleanPackageShrinkwrap"
        - path: "compute-image/Dockerfile"
          symbol: "ENTRYPOINT"
        - path: "compute-image/Dockerfile.dockerignore"
          symbol: "node_modules"
      tests:
        - path: "test/npm-package-contents.test.mjs"
          name: "npm package excludes generated VSIX artifacts while keeping runtime assets"
        - path: "test/package-shrinkwrap.test.mjs"
          name: "package lifecycle publishes the repository lock as npm-shrinkwrap.json"
        - path: "test/package-shrinkwrap.test.mjs"
          name: "published package metadata includes and cleans the generated shrinkwrap"
        - path: "test/compute-image-build.test.mjs"
          name: "compute image build falls back to package-owned inputs outside a source checkout"
      public:
        - "@pasko70/pibo npm tarball"
        - "prepack and postpack"
        - "npm-shrinkwrap.json"
      failures:
        - "Reject package-name mismatch and propagate copy/cleanup/pack failures; lifecycle cleanup is not transactional across process termination."
        - "Allowlisting limits published files; lock/shrinkwrap fixes the resolved graph even though manifest ranges remain."
        - "npm package lifecycle on Node >=24; tarball consumers receive pibo and rg bins, not declared main/types/exports."
      confidence: "high"
      follow_up: "Install the validated tarball into a clean temporary project and smoke pibo/rg; package-root library imports remain intentionally undeclared pending an explicit API decision."
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
        - path: "test/setup-installation-proxy.test.mjs"
          name: "BI proxy plan places the Pibo auth gate before HTTP and WebSocket forwarding"
        - path: "test/setup-installation-proxy.test.mjs"
          name: "generated BI proxy rejects unauthenticated HTTP and WebSockets and forwards authenticated traffic"
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
          symbol: "currentGitCommit"
        - path: "scripts/release.mjs"
          symbol: "currentGitTag"
        - path: "scripts/release.mjs"
          symbol: "runInherit"
        - path: "scripts/release.mjs"
          symbol: "const args = parseArgs"
        - path: "scripts/create-github-release.mjs"
          symbol: "createRelease"
        - path: "scripts/create-github-release.mjs"
          symbol: "ASSET_MAX_BYTES"
        - path: "scripts/vscode-package.mjs"
          symbol: "expectedFilename"
        - path: "scripts/vscode-package.mjs"
          symbol: "targetPath"
        - path: "scripts/vscode-package.mjs"
          symbol: "latestPath"
        - path: "src/apps/chat-vscode/package.json"
          symbol: "version"
        - path: "src/apps/chat-vscode/package.json"
          symbol: "publisher"
        - path: "src/apps/chat-vscode/package.json"
          symbol: "name"
        - path: "package.json"
          symbol: "version"
        - path: "package.json"
          symbol: "scripts.release"
        - path: "package.json"
          symbol: "scripts.release:github"
      source_inspected: true
      tests:
        - path: "test/create-github-release.test.mjs"
          name: "uploads a valid asset after creating a new release"
        - path: "test/create-github-release.test.mjs"
          name: "accepts an asset exactly at the size limit during preflight"
        - path: "test/create-github-release.test.mjs"
          name: "rejects a missing asset before any GitHub request"
        - path: "test/create-github-release.test.mjs"
          name: "rejects a directory asset before any GitHub request"
        - path: "test/create-github-release.test.mjs"
          name: "rejects an oversized asset before any GitHub request"
        - path: "test/create-github-release.test.mjs"
          name: "CLI rejects an unreadable asset without remote mutation"
        - path: "test/create-github-release.test.mjs"
          name: "keeps an existing release unchanged"
      public:
        - "npm run release"
        - "npm run release:github"
        - "GitHub Release VSIX asset"
      failures:
        - "Reject invalid SemVer, dirty/mismatched tag, missing/wrong VSIX, oversized asset, or GitHub/npm errors; existing release returns without repair."
        - "GitHub asset is capped at 64 MiB but not signed or checksummed; credentials remain external environment concerns."
        - "Node release scripts and external npm/git/GitHub CLIs; no live GitHub/npm publication or Windows acceptance was performed."
      confidence: "high"
      follow_up: "Add missing hermetic release.mjs coverage for two-manifest version writes and tag/push boundaries; test live npm/GitHub flows only in disposable registries and repositories."
---
# Package, Build, Installation, Deployment, and Release

## Authority and evidence boundary

- Stable concept: `SPC-DEL-001`.
- Current-behavior authority: upstream refresh `39090b8850758293e69380a52bb7498d7c955bc2`.
- Raw-package parent: accepted commit `ca8de98aaf1a536006b9e5f0e3a070da1d5070bd`.
- Source and named-test locators identify regular upstream/dev refresh blobs. Executed package checks prove candidate/parent parity only; they do not prove live or external behavior.
- This specification contains implemented current behavior only. Follow-ups and gaps are non-normative.

## Scope

### In scope

- The root npm package manifest, pibo and rg binaries, server/workflow/web/VS Code build graph, pack allowlist, and generated shrinkwrap lifecycle.
- Supported setup profile planning/apply/status/upgrade/component-add/uninstall and managed gateway web/dev lifecycle commands.
- Standalone Dockerfile/Compose behavior, host deploy scripts, release version bump/build/package/publish orchestration, and GitHub Release asset upload.

### Out of scope

- Feature-level runtime, auth, workflow, web UI, or extension behavior supplied inside artifacts.
- Workflow validation semantics, test-suite selection, or system acceptance; SPC-VAL-001 owns validation contracts.
- Upstream Git branching, tagging, pushing, release approval, Marketplace processing, or production approval decisions.
- Docker compute workers; the root standalone Docker runtime is a separate delivery surface.

## Current behavior

### Public surfaces

- @pasko70/pibo package with pibo and rg binaries.
- npm run build|typecheck|prepack|postpack|vscode:package|release.
- pibo setup and pibo gateway web|dev status|start|restart|doctor.
- Dockerfile, docker-compose.yml, deploy-web-dev.sh, deploy-web.sh, release.mjs, and create-github-release.mjs.

### State

- Builds emit server/workflow declarations and JS under dist plus three Vite app roots; VSIX artifacts are excluded from npm packing. The package includes the package-owned compute-image Dockerfile, its Dockerfile-specific ignore file, and the three runtime preparation scripts required to build a worker outside a source checkout. The root `.dockerignore` remains excluded so packaged image builds retain `dist/`.
- Setup records a private schemaVersion-1 manifest with owned-file digests, modes, components, and action fingerprints.
- Gateway web and dev use distinct service names, ports, and default Pibo Homes; production restart inspects active runtime and yielded-run state.
- Docker Compose persists /root/.pibo and /root/.browser-use; release artifacts live under dist/apps/vscode-artifacts.

### Lifecycle

- Root build compiles the private workflow workspace, server TypeScript, Chat and Context Vite apps, VS Code webview, and executable bins; extension bundling/VSIX packaging remains a separate command.
- Setup plans before mutation, requires --apply --yes and root on Linux, preflights every destination, writes atomically, fingerprints completed actions, and preserves modified files/data on transitions and uninstall.
- Deploy-dev syncs a clean canonical dev worktree, builds, and probes a configured public URL without restarting. Deploy-prod builds and refreshes the stable backup without restarting. Ordering and production approval are operator policy, not enforced between the two scripts.
- Release writes root and extension versions, builds, packages VSIX, optionally publishes npm, and only creates a GitHub Release when HEAD already has the expected tag; it never creates/pushes commits or tags. GitHub release creation validates asset existence, regular-file type, readability, and the 64 MiB limit before the first remote mutation.

### Failure

- Build, pack, setup, deploy, backup, and release scripts fail on command errors; setup refuses unmanaged/modified target overwrites and incomplete public-auth configuration.
- Production restart blocks on unreachable/ambiguous/wrong-mode status, processing, streaming, queued messages, stale telemetry, or active yielded runs unless the exact force confirmation token is supplied.
- GitHub Release creation is tag-idempotent; invalid local assets fail before any GitHub request, upload failures remain explicit, and an existing release is left unchanged rather than repaired implicitly.

### Security

- Node >=24, a package files allowlist, production shrinkwrap, exact selected dependency pins plus lockfile resolution, private setup files, checksummed code-server downloads, and public Better Auth validation constrain delivery.
- Deploy scripts never restart directly; the gateway CLI owns activation safety.
- GitHub App credentials remain external and the uploaded asset is capped at 64 MiB; no signing or checksum manifest is produced.
- The Dockerfile downloads uv through a remote shell and runs npm install rather than npm ci; no focused Docker supply-chain test exists.

### Platform and compatibility

- Root package requires Node >=24. Server TypeScript targets ES2023/NodeNext and excludes all browser/extension trees.
- Vite apps build from separate roots; package/release scripts select cmd.exe npm.cmd/npx.cmd on Windows where implemented.
- Host setup apply supports Linux only; plans warn that native Windows is unsupported. Gateway management has a Windows process-manager fallback.
- Standalone Docker uses node:24-slim and installs x64/arm64-independent Debian packages, while setup's code-server download supports only x64 and arm64.

## Requirements and invariants

## Requirement: DELIVERY-PACKAGE-001: Current implemented contract

The delivery system MUST build the private workflow workspace, server TypeScript, Chat and Context web apps, VS Code webview, and executable pibo/rg binaries from separate roots; bundle/package the extension host only through the separate VSIX command.

### Acceptance and boundaries

- Exact source evidence: `package.json:54` — `scripts.build`; `package.json:50` — `scripts.workflows:build`; `package.json:45` — `scripts.web-ui:build`; `package.json:47` — `scripts.vscode:webview:build`; `package.json:49` — `scripts.vscode:package`; `package.json:25` — `bin`; `tsconfig.json:2` — `compilerOptions`; `tsconfig.json:15` — `include`; `tsconfig.json:16` — `exclude`; `packages/workflows/package.json:16` — `scripts.build`; `packages/workflows/package.json:7` — `main`; `packages/workflows/package.json:8` — `types`; `packages/workflows/package.json:9` — `exports`; `src/apps/chat-ui/vite.config.ts:9` — `export default defineConfig({`; `src/apps/context-files-ui/vite.config.ts:9` — `export default defineConfig({`; `src/apps/chat-vscode/extension/webview/vite.config.ts:9` — `export default defineConfig({`; `src/bin/pibo.ts:5` — `await runPiboCli()`; `src/bin/rg.ts:6` — `const child = spawn`
- Exact named tests: `test/rg-bin.test.mjs:5` — “bundled rg wrapper executes ripgrep”; `test/static-assets.test.mjs:77` — “built Chat and VS Code assets use explicit deterministic compression with stable caching”
- Public surfaces: `npm run build`; `npm run vscode:package`; `pibo and rg binaries`
- Failure boundary: Any sub-build failure stops the composed command; no partial-output rollback is promised.
- Security boundary: Server compilation excludes browser and extension trees; executable entrypoints are explicit.
- Platform and compatibility boundary: Node >=24, ES2023/NodeNext server output, Vite browser outputs, and platform-aware npm/npx wrappers.
- Confidence: **high**
- Evidence gap and follow-up: Run typecheck/build plus rg/static-asset tests, then add a build-graph test asserting expected outputs and the intentional absence of extension.cjs/VSIX from root build alone.

#### Later validation commands

```text
npm run typecheck && npm run build
node scripts/run-test-suite.mjs test/rg-bin.test.mjs test/static-assets.test.mjs
```


## Requirement: DELIVERY-PACKAGE-002: Current implemented contract

The delivery system MUST pack only the root manifest allowlist, exclude dist/apps/vscode-artifacts, include runtime assets and npm-shrinkwrap.json, and create/clean the shrinkwrap by copying the repository lock after package-name validation.

### Acceptance and boundaries

- Exact source evidence: `package.json` — `files`, `dependencies`, `scripts.prepack`, `scripts.postpack`, and `engines`; `package-lock.json` — `lockfileVersion` and `packages`; `scripts/package-shrinkwrap.mjs` — `preparePackageShrinkwrap` and `cleanPackageShrinkwrap`; `compute-image/Dockerfile` — package-owned worker image; `compute-image/Dockerfile.dockerignore` — effective build-context exclusions; `docs/project/operations/index.md` — `# Project operations`
- Exact named tests: `test/npm-package-contents.test.mjs:65` — “npm package excludes generated VSIX artifacts while keeping runtime assets”; `test/package-shrinkwrap.test.mjs:9` — “package lifecycle publishes the repository lock as npm-shrinkwrap.json”; `test/package-shrinkwrap.test.mjs:31` — “published package metadata includes and cleans the generated shrinkwrap”
- Public surfaces: `@pasko70/pibo npm tarball`; `prepack and postpack`; `npm-shrinkwrap.json`
- Failure boundary: Reject package-name mismatch and propagate copy/cleanup/pack failures; lifecycle cleanup is not transactional across process termination.
- Security boundary: Allowlisting limits published files; lock/shrinkwrap fixes the resolved graph even though manifest ranges remain.
- Platform and compatibility boundary: npm package lifecycle on Node >=24; tarball consumers receive pibo and rg bins, not declared main/types/exports.
- Confidence: **high**
- Evidence and follow-up: The package tests, actual `npm pack`, extracted membership, packaged-document link closure, and installation into an empty directory with `npm install --omit=dev` passed. The installed CLI reported its version and help, the canonical persistent Workflow service created and reopened, no workspace-package symlink was present, and no retired storage was created. Package-root library imports remain intentionally undeclared pending an explicit API decision.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/npm-package-contents.test.mjs test/package-shrinkwrap.test.mjs
npm pack --dry-run --json --ignore-scripts
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
- Exact named tests: `test/gateway-restart-safety.test.mjs:14` — “blocks with processing sessions”; `test/gateway-restart-safety.test.mjs:28` — “blocks with active yielded runs”; `test/gateway-restart-safety.test.mjs:37` — “exports the exact force confirmation token”; `test/gateway-restart-safety.test.mjs:51` — “do not call direct restart, stop, or kill operations”; `test/gateway-restart-safety.test.mjs:62` — “print CLI restart instructions”; `test/gateway-restart-safety.test.mjs:66` — “keeps hosted dev public URLs in environment configuration”; `test/setup-installation-proxy.test.mjs:55` — “BI proxy plan places the Pibo auth gate before HTTP and WebSocket forwarding”; `test/setup-installation-proxy.test.mjs:74` — “generated BI proxy rejects unauthenticated HTTP and WebSockets and forwards authenticated traffic”
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

The delivery system MUST validate SemVer, update the root and extension package versions together, build and package the expected VSIX, optionally publish npm, and create an existing-tag GitHub Release with one asset capped at 64 MiB; do not create or push commits/tags, and do not claim lockfile, checksum, signing, Marketplace, or missing-asset repair behavior.

### Acceptance and boundaries

- Exact source evidence: `scripts/release.mjs` — `parseArgs`, `currentGitCommit`, `currentGitTag`, and `runInherit`; `scripts/create-github-release.mjs` — `createRelease`, `preflightReleaseAsset`, and `ASSET_MAX_BYTES`; `scripts/vscode-package.mjs` — `expectedFilename`, `targetPath`, and `latestPath`; `src/apps/chat-vscode/package.json` — `version`, `publisher`, and `name`; `package.json` — `version`, `scripts.release`, and `scripts.release:github`; `docs/project/operations/vscode-extension-release.md` and `docs/project/guides/pibo-vscode-ext-quickstart.md` — release operation guidance.
- Named tests: `test/create-github-release.test.mjs` — valid upload, missing/directory/oversized/unreadable preflight rejection before remote mutation, exact-size acceptance, existing-release preservation, and controlled upload-failure behavior.
- Public surfaces: `npm run release`; `npm run release:github`; `GitHub Release VSIX asset`
- Failure boundary: Reject invalid SemVer, dirty/mismatched tag, missing/wrong VSIX, oversized asset, or GitHub/npm errors; existing release returns without repair.
- Security boundary: GitHub asset is capped at 64 MiB but not signed or checksummed; credentials remain external environment concerns.
- Platform and compatibility boundary: Node release scripts and external npm/git/GitHub CLIs; no live GitHub/npm publication or Windows acceptance was performed.
- Confidence: **high**
- Evidence gap and follow-up: Add missing hermetic `release.mjs` coverage for two-manifest version writes and tag/push boundaries; test live npm/GitHub flows only in disposable registries and repositories.

#### Later validation commands

```text
node scripts/release.mjs --version 1.7.2 --dry-run
```


## Interfaces and ownership

### Owned capability IDs

- `pibo.product.package-api`
- `pibo.operator.gateway-lifecycle`
- `pibo.delivery.build`
- `pibo.delivery.docker-deploy`
- `pibo.delivery.release`

### Public surfaces

- @pasko70/pibo package with pibo and rg binaries.
- npm run build|typecheck|prepack|postpack|vscode:package|release.
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
| focused tests | performed | Package, release-preflight, setup, gateway, and affected tests passed in the isolated worker; the clean full suite passed 2,638 tests with 0 failures and 5 skips. |
| build package checks | performed-partial | Build, typecheck, actual npm pack, extracted archive membership, packaged Markdown link closure, and empty-directory `npm install --omit=dev` passed. Installed CLI version/help, canonical persistent Workflow service reopen, absence of workspace-package symlinks, and absence of retired storage were checked. VSIX packaging and Docker image build were not run. |
| local real path pty headful browser validation | not-applicable | The canonical target does not require this evidence class; UI acceptance belongs to dependent targets. |
| external provider pibo2 acceptance | unperformed | No npm, GitHub Release, Marketplace, external host, or Pibo2 acceptance was run. |

The rebound statuses describe the input audit before this package's deterministic execution. The external and real-path gaps below remain unverified regardless of candidate/parent test parity.

## Reconciled stale-claim rejections

12. Reject a published package-root library API claim: package.json has no main, types, or exports fields. src/index.ts is a source export barrel compiled under dist, not a declared package-root export.
13. Reject claims that root build packages the extension host or VSIX; it builds only the VS Code webview. vscode:package separately bundles the extension and creates VSIX files.
14. Reject claims that every manifest dependency is exact-pinned; package.json mixes exact versions and ranges, while package-lock/npm-shrinkwrap supplies full resolution.
15. Reject managed gateway stop-command claims; web/dev expose status, start, restart, and doctor only.
16. Reject code-enforced dev-before-production deployment; AGENTS/operator policy requires it, but deploy-web.sh can run independently.
17. Reject a fully synchronized version claim across lock metadata: release.mjs updates root package.json and extension package.json, not package-lock.json.
18. Reject automatic tags, pushes, Marketplace uploads, signing, or release-asset repair claims.
19. Reject claims that Docker and release behavior have focused tests; none were found.

## Evidence gaps and non-normative follow-ups

8. No package-root import test proves an exported library API, and the current manifest does not declare one.
9. No focused test builds/runs Dockerfile or Compose, checks entrypoint auth behavior, or verifies exposed/published ports.
10. No focused test covers release.mjs, createRelease, version/lockfile consistency, asset cap, existing-release missing-asset behavior, npm publish, or Marketplace upload.
11. Production deployment approval and dev-first ordering remain external process gates.
12. The production backup implementation rebuilds a broad source copy under ~/.pibo/stable and shares ~/.pibo by symlink; no focused backup test is cited.

These gaps do not define intended behavior. Any implementation change requires a separate plan and later source/test reconciliation.

## Verification and traceability

- Every requirement traces to exact regular files at upstream/dev refresh `39090b8850758293e69380a52bb7498d7c955bc2`.
- Named tests are identified by exact test names. Source-only requirements set `source_inspected: true` and carry a concrete follow-up.
- Deterministic wrappers, source guards, archive checks, and accelerated fixtures are bounded evidence. They are not substitutes for headful VS Code, real workspace activation, real PTY, live browser/CDP, provider, controller gateway, Docker runtime, release publication, deployment, or Pibo2 acceptance.
- Package execution results belong to the implementation audit, not to the normative current-behavior claim. Final acceptance at `7ec71c2cca2108423002be0e7330d2a20c4c5b67` added a passing empty-directory `npm install --omit=dev` smoke without rebinding unchanged package source traceability.

## Related concepts

- [SPC-ORCH-005](/specs/orchestration/workflow-framework-runtime-store.md) — linked owner; this specification does not duplicate its contract.
- [SPC-SEC-003](/specs/security/gateway-admission-and-restart.md) — linked owner; this specification does not duplicate its contract.
- [SPC-VSC-002](/specs/vscode/sidecar-webview-and-delivery.md) — linked owner; this specification does not duplicate its contract.
