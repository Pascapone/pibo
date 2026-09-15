---
type: "Guide"
title: "Plugin development and operations"
description: "Shows how to build, inspect, install, activate, update, diagnose, and remove an independent Pibo 4 plugin package."
tags: ["plugins", "development", "operations", "packages"]
status: "stable"
authority: "directive"
generated:
  by: "openai/codex"
  at: "2026-09-15T03:35:09Z"
sources:
  - resource: "scope:Public plugin SDK, CLI help, example package, and tests at d37dea0c7870e426e35911b574af1af07dfa7cd2"
---

# Purpose

A Pibo 4 plugin is an independently delivered immutable artifact. Its manifest declares identity, entrypoints, dependencies, configuration, and contributions. Backend code registers only the declared contribution IDs through an ownership-scoped setup context. Browser code exports the declared views and optional browser setup.

Start with the Hello Pibo example at `examples/plugins/hello-pibo/`. The repository regression `test/plugin-system-public-runtime.test.mjs` also compiles and runs an out-of-repository package through public package subpaths only.

# Package boundary

Use these public imports:

- `@pasko70/pibo/plugin-sdk` for manifest, browser, and view contracts.
- `@pasko70/pibo/plugin-host` for backend setup and activation contracts.
- `@pasko70/pibo/plugin-runtime` for Session-scoped tools and runtime services.

Do not import `src/`, `dist/` internals, `plugin-builtin`, or legacy registry APIs. Pibo's installer does not run a package manager or install arbitrary dependencies. Bundle the package's runtime closure and keep `@pasko70/pibo` as a supported peer.

A distributable package contains:

```text
pibo.plugin.json
package.json
dist/backend.js
dist/browser.js
```

The manifest must name exact files inside the artifact. A workspace view declares `view.presentation`, `exportName`, instance policy, mount policy, and state schema version. Every registered backend contribution must match a manifest contribution ID.

# Build the example

From `examples/plugins/hello-pibo`:

```bash
npm install
npm run build
npm pack --dry-run
```

The build emits ESM and declarations into `dist/`. `npm pack --dry-run` should list the manifest and built entrypoints without `node_modules` or source-checkout dependencies.

# Inspect without execution

Run inspection before installation:

```bash
pibo plugins inspect . --json
```

Inspection validates manifest shape, SDK range, paths, archive boundaries, services, contribution metadata, and content identity. It does not import backend or browser code.

To inspect the packed artifact instead:

```bash
npm pack
pibo plugins inspect ./example-hello-pibo-plugin-1.0.0.tgz --json
```

# Install and activate

Create a staged installation with compare-and-swap revision zero:

```bash
pibo plugins install . --expected-revision 0 --json
pibo plugins status org.example.hello-pibo --json
```

Read `stateRevision` from status, then activate that exact revision through the owning host lifecycle:

```bash
pibo plugins activate org.example.hello-pibo --expected-revision <stateRevision> --json
```

Activation verifies all artifact hashes before the first backend import. It plans service dependencies, registers contributions under the package owner, and publishes one active generation. A failed activation keeps the package inactive and removes partial registrations.

After activation, enable optional agent-scoped contributions in the Agent Designer. App-scoped required contributions, such as the example workspace view, follow the installed package state.

# Choose Minimal or Standard installation

Minimal-Core is `@pasko70/pibo`. It starts with Core auth, base Web, Chat, user resources, and zero plugin or runtime installations. Use it when an operator will install every feature and runtime explicitly.

The Standard composition pins the exact Core and first-party package versions. It installs the normal product feature and runtime set as independent artifacts; it does not restore aggregate ownership or legacy delivery.

Build candidate artifacts with:

```bash
npm run pibo4:packages
```

The output contains Minimal-Core at `dist/pibo4-core-package`, Standard at `dist/pibo4-standard-package`, the separate cutover tool at `dist/pibo4-cutover-package`, and 20 independently packable first-party artifacts below `dist/pibo4-artifacts`.

The repository root is a private build workspace. Its broad `dist/` tree is not the `@pasko70/pibo` release package and must not be used as npm delivery evidence. `node scripts/release.mjs --version <version> --publish-npm` publishes only the generated Minimal-Core, Cutover, each listed plugin artifact, and Standard package. It verifies every package name and version plus the exact Standard dependency pins before the first publish. A bare root `npm publish` is intentionally blocked by the root `prepublishOnly` guard; `private: true` also marks that the manifest is workspace-only.

For pre-publication review, pack each generated directory rather than the repository root:

```bash
npm pack --ignore-scripts ./dist/pibo4-core-package
npm pack --ignore-scripts ./dist/pibo4-cutover-package
npm pack --ignore-scripts ./dist/pibo4-artifacts/preview
npm pack --ignore-scripts ./dist/pibo4-standard-package
```

The release sequence is not atomic across npm packages. If a later publish fails, stop, record the packages already published, and resume only after reconciling their immutable versions; never rebuild different bytes under an already published version.

# Upgrade from the monolith

Do not replace `@pasko70/pibo@3.6.2` directly with Minimal-Core. Before replacement, run the separately packed `@pasko70/pibo-cutover` tool with the retained 3.6.2 tarball, the exact target Core tarball, every target plugin tarball, and the current legacy selection snapshot. Preserve the generated plan and source backup.

The cutover plan binds source bytes, target bytes, versions, and active, disabled, or uninstalled choices. Minimal-Core verifies that plan before opening product data. Missing files, changed hashes, wrong versions, active owners absent from the plan, or attempts to re-enable defaults fail closed.

Startup and first Chat load perform journaled data imports for retained Session stores and browser-v1 workspace state. Sources and immutable backups remain unchanged. Conflicting current records are not overwritten; Plugin Recovery and the migration report identify the exact Session or owner that needs manual repair. Restore the retained package and data backup if the new Core cannot verify or complete the cutover.

# Runtime support boundary

Pi and Codex Native packages support their documented binding inspection and recovery contracts. OMP remains an installable, functional runtime package for its validated normal operation. Its protocol cannot prove native absence safely, so failed resume and persisted missing bindings fail explicitly; Pibo 4 does not add OMP reconstruction or cross-runtime recovery guarantees.

# Update safely

Build a new immutable artifact with a new package version, then use the current installation revision:

```bash
pibo plugins update ./example-hello-pibo-plugin-1.1.0.tgz --expected-revision <stateRevision> --json
pibo plugins status org.example.hello-pibo --json
pibo plugins activate org.example.hello-pibo --expected-revision <newStateRevision> --json
```

An update stages new bytes without changing the running generation. Activation closes admission, drains affected work, and swaps generations at a controlled boundary. Source changes after staging cannot alter staged execution.

# Diagnose and recover

Use progressively deeper commands:

```bash
pibo plugins list
pibo plugins status org.example.hello-pibo
pibo plugins doctor org.example.hello-pibo
pibo plugins operations list
pibo plugins operations show <operationId>
pibo plugins recover --json
```

`doctor` reports lifecycle availability, revisions, pending changes, and operation errors. Recovery reconciles durable checkpoints with real host state. Uncertain cleanup remains blocked rather than being reported as success.

# Configure a plugin

A plugin that declares configuration schemas uses explicit scope and CAS revisions:

```bash
pibo plugins config schema org.example.hello-pibo --json
pibo plugins config show org.example.hello-pibo --scope app --json
pibo plugins config set org.example.hello-pibo \
  --scope app \
  --schema-version 1 \
  --expected-revision <revision> \
  --values-json '{"message":"Hello"}' \
  --json
```

Configuration values replace one explicit target. Credentials must be secret-reference objects rather than plaintext values.

# Uninstall without deleting product data

First create an expiring impact plan:

```bash
pibo plugins uninstall plan org.example.hello-pibo --json
```

Review the returned consumers and revision. Confirm with the exact plugin ID text:

```bash
pibo plugins uninstall confirm <planId> \
  --plugin-id-text org.example.hello-pibo \
  --expected-revision <stateRevision> \
  --json
```

Uninstall closes admission, drains existing work, and removes executable registrations. Session records, plugin configuration, tabsets, and migration evidence remain available for reinstall or repair.

# Failure checklist

If installation or activation fails, check these in order:

1. `pibo plugins inspect <artifact> --json` reports no manifest or path diagnostics.
2. The SDK range includes the host's plugin SDK version.
3. All backend and browser files are inside the artifact and match their hashes.
4. Backend imports use public Pibo subpaths only.
5. Required Core or plugin services have compatible providers.
6. Registered contribution IDs exactly match the manifest.
7. `pibo plugins doctor <plugin-id>` reports no blocked operation or uncertain cleanup.

Do not bypass inspection, alter persisted revisions manually, or restore legacy registration surfaces. Fix the artifact or complete recovery, then retry with the current revision.

# Related concepts

- [Plugin Packages, Capabilities, and Profiles](/specs/product/plugin-profile-catalog.md)
- [Agent Runtime Adapter Contract](/specs/runtime/adapter-contract.md)
- [Session Workspace Lifecycle](/specs/web/session-workspace-lifecycle.md)
