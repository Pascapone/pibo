# Implement Pibo-Managed Pi Package Layer

## Hard Constraint

This task must not modify `pi-mono`.

`<HOME>/code/pi-mono` is a read-only reference and dependency source for this work. The implementation must live only in `<HOME>/code/pibo`.

Forbidden actions:

- Do not edit files under `<HOME>/code/pi-mono`.
- Do not add tests under `<HOME>/code/pi-mono`.
- Do not run package installation commands in `<HOME>/code/pi-mono`.
- Do not propose or implement upstream Pi SDK hooks as part of this task.
- Do not patch `node_modules`.

Allowed actions:

- Read installed dependency type declarations under `node_modules/@mariozechner/*`.
- Read `pi-mono` docs or source for understanding only.
- Use public APIs exported by `@mariozechner/pi-coding-agent` and related dependencies from Pibo.
- Add Pibo-owned adapters, stores, APIs, CLI commands, runtime wiring, and UI.

If a required capability is not available through public dependency APIs, stop and document the exact blocker in the Pibo plan or diagnostics. Do not solve it by changing Pi Coding Agent source.

## Goal

Build a small Pibo-owned application layer for Pi Coding Agent packages.

Pibo should be able to:

- register Pi Package sources,
- inspect package metadata and resources,
- install or resolve package sources into a Pibo-managed location,
- attach selected packages to Pibo profiles or Custom Agents,
- ask Pi Coding Agent to load selected package resources at runtime through public dependency APIs,
- later expose add/edit/remove controls in Chat Web.

Pi Coding Agent remains the embedded engine. Pibo owns product policy, package selection, persistence, UI, and diagnostics.

## Non-Goals

- No changes to Pi Coding Agent source.
- No global Pi package management through `~/.pi` as Pibo's source of truth.
- No automatic activation of every installed package in every profile.
- No replacement of Pibo's native MCP, subagent, run-control, or provider-backed tool systems.
- No broad marketplace or trust-review system in V1.
- No fine-grained per-resource package filtering in V1 unless the public dependency API already makes it trivial.

## Product Boundary

Pi owns:

- package resource semantics,
- extension execution inside Pi runtime,
- Pi-owned skills, prompts, themes, and extension lifecycle,
- model loop, transcript, tools, streaming, and compaction.

Pibo owns:

- package registration and removal,
- source validation,
- Pibo-local install/cache location,
- package metadata and diagnostics,
- Custom Agent package selection,
- profile-to-runtime package selection,
- Chat Web and CLI management surfaces,
- policy warnings and operational visibility.

## Terms

**Pi Package**: A package intended for Pi Coding Agent. It may provide extensions, skills, prompts, themes, or other Pi resources.

**Pibo Pi Package**: A Pibo store record that represents one registered Pi Package source, install spec, metadata, install status, discovered resources, and diagnostics.

**Pi Package Selection**: The per-profile or per-Custom-Agent list of Pibo Pi Package IDs that Pibo asks the runtime to load.

**Runtime Bridge**: The small Pibo module that converts selected Pibo Pi Packages into runtime inputs accepted by public Pi Coding Agent dependency APIs.

## Required Architecture

Create or complete these Pibo modules:

```text
src/pi-packages/types.ts
src/pi-packages/store.ts
src/pi-packages/metadata.ts
src/pi-packages/installer.ts
src/pi-packages/runtime.ts
src/pi-packages/cli.ts
```

Responsibilities:

- `types.ts`: shared Pibo-owned data contracts.
- `store.ts`: load/save `.pibo/pi-packages.json`; no Pi global settings dependency.
- `metadata.ts`: parse sources, inspect package metadata, discover declared resources.
- `installer.ts`: install or resolve packages into Pibo-owned paths.
- `runtime.ts`: convert selected package records into public Pi runtime/resource-loader options.
- `cli.ts`: progressive CLI for registration, inspection, removal, and diagnostics.

Keep all version-sensitive dependency integration inside `runtime.ts` and `installer.ts`.

## Data Contracts

### Store File

Path:

```text
.pibo/pi-packages.json
```

Schema:

```ts
type PiboPiPackageStoreFile = {
  version: 1;
  packages: PiboPiPackageInfo[];
};
```

### Package Record

```ts
type PiboPiPackageInfo = {
  id: string;
  name: string;
  source: string;
  installSpec: string;
  description?: string;
  version?: string;
  repositoryUrl?: string;
  resourceTypes: Array<"extension" | "skill" | "prompt" | "theme">;
  extensionPaths?: string[];
  skillNames?: string[];
  promptNames?: string[];
  themeNames?: string[];
  discoveredToolNames?: string[];
  installStatus: "registered" | "installed" | "missing" | "error";
  installPath?: string;
  diagnostics: PiboPiPackageDiagnostic[];
  addedAt: string;
  updatedAt: string;
};

type PiboPiPackageDiagnostic = {
  type: "info" | "warning" | "error";
  message: string;
};
```

### Profile Selection

Add package selection to Pibo profile context:

```ts
type PiPackageProfile = {
  id: string;
  enabled?: boolean;
};
```

`InitialSessionContext` should expose:

```ts
piPackages?: readonly PiPackageProfile[];
```

Add builder methods:

```ts
withPiPackages(packages: readonly PiPackageProfile[]): this
addPiPackage(pkg: PiPackageProfile): this
addPiPackages(packages: readonly PiPackageProfile[]): this
```

### Custom Agent Persistence

Add to Custom Agent definitions:

```ts
piPackages: string[];
```

Migration:

- Add `pi_packages_json TEXT NOT NULL DEFAULT '[]'`.
- Sanitize to unique trimmed strings.
- Validate on save that each selected package is registered in Pibo.

## Source Handling

### Supported V1 Inputs

```text
https://pi.dev/packages/pi-web-access
https://pi.dev/packages/@scope/package-name
./relative/local-package
/absolute/local-package
```

### URL Rules

- Only `https://pi.dev/packages/<name>` URLs are accepted as web URLs.
- Other `http://` or `https://` URLs are rejected.
- `https://pi.dev/packages` without a package name is rejected.
- Scoped package names must preserve the slash after decoding.
- URL registration creates an npm install spec such as `npm:pi-web-access` or `npm:@scope/package-name`.

### Local Path Rules

- Resolve relative paths against current Pibo cwd.
- The path must exist.
- Directory packages read `package.json` when present.
- File inputs may be treated as a single extension source only if public Pi APIs support that shape.
- V1 does not copy local package source; it stores the resolved path.

## Installer Requirements

V1 should install or resolve packages into Pibo-owned storage, not Pi global state.

Preferred storage:

```text
.pibo/pi-packages/
  npm/
  git/
  local/
```

Requirements:

- Do not run install commands in `pi-mono`.
- Do not modify Pibo's root `package.json` or `package-lock.json` for user-installed Pi Packages.
- Use a package-specific install directory or cache under `.pibo/pi-packages`.
- Store install status and diagnostics in `pi-packages.json`.
- A failed install must not corrupt existing registered package records.

Implementation options for npm packages:

- Use `npm view` or registry HTTP API for metadata.
- Use `npm pack` plus extract, or `npm install --prefix <pibo-package-cache-dir> <package>`.
- Keep command execution scoped to `.pibo/pi-packages/...`.

The implementer must choose the smallest reliable option already compatible with this repo's runtime.

## Runtime Bridge Requirements

`src/pi-packages/runtime.ts` must be the only module that knows how Pibo-selected packages become Pi runtime resources.

Inputs:

```ts
type PiPackageRuntimeInput = {
  selected: readonly PiPackageProfile[];
  cwd: string;
};
```

Output:

```ts
type PiPackageRuntimeOptions = {
  extensionFactories?: unknown[];
  resourceLoaderOptions?: Record<string, unknown>;
  diagnostics: PiboPiPackageDiagnostic[];
};
```

Rules:

- Resolve selected package IDs through the Pibo package store.
- Missing selected packages produce diagnostics and are skipped.
- Packages with `installStatus: "error"` are skipped.
- Only selected packages for the current profile are loaded.
- Runtime diagnostics must name each package that was loaded, skipped, or failed.
- Do not read global Pi settings as active package selection.
- Do not mutate Pi Coding Agent internals.

Integration target:

- `src/core/runtime.ts` should ask `getPiPackageRuntimeOptions(...)` for the current profile.
- Merge returned public runtime/resource-loader options into existing `createAgentSessionServices` or equivalent runtime creation.
- Keep existing Pibo extension factories intact.

Stop condition:

- If the installed Pi Coding Agent dependency does not expose a public way to load package extension/skill resources from arbitrary paths, do not patch Pi. Implement store, CLI, metadata, profile selection, and diagnostics first; leave runtime loading disabled with a clear diagnostic.

## Capability Catalog

Extend the Pibo Capability Catalog with:

```ts
piPackages: PiboPiPackageInfo[];
```

Requirements:

- Catalog includes registered packages even if not installed, with diagnostics.
- Catalog does not imply activation.
- Agent Designer uses this list for package toggles.

## CLI

Add progressive command group:

```text
pibo pi-packages
  list
  add <source>
  inspect <name-or-id>
  remove <name-or-id>
  doctor
```

Help rules:

- `pibo pi-packages --help` shows only immediate commands.
- Detailed schema and diagnostics are behind `inspect` or `doctor`.
- Output should be compact and line-based by default.
- Add `--json` only where existing CLI patterns support it cleanly.

Expected outputs:

```text
Added Pi package pi-web-access
  source: https://pi.dev/packages/pi-web-access
  install: npm:pi-web-access
  status: installed
Next: pibo pi-packages inspect pi-web-access
```

```text
Unsupported Pi package URL.
Expected a URL starting with https://pi.dev/packages/ or a local path.
```

## Chat Web API

Backend endpoints:

```text
GET    /api/chat/pi-packages
POST   /api/chat/pi-packages
GET    /api/chat/pi-packages/:id
PATCH  /api/chat/pi-packages/:id
DELETE /api/chat/pi-packages/:id
```

V1 minimum:

- `GET`: list registered packages.
- `POST`: register source from `{ source }`.
- `GET :id`: inspect one package.
- `DELETE :id`: remove registration.

Optional V1 if small:

- `PATCH :id`: edit display metadata or refresh source.

Validation:

- Reject unknown package IDs.
- Reject invalid sources.
- Do not allow deleting a package that is selected by a Custom Agent unless the response clearly reports affected agents, or unless deletion automatically removes the selection from those agents in one transaction.

## Chat Web UI

Later UI target:

- Agent Designer shows a `Pi Packages` section.
- Registered packages can be toggled per Custom Agent.
- A management panel allows add-by-link, inspect, remove, and refresh.
- The UI must display warning text that Pi package extensions execute code inside the runtime.

V1 UI should be small:

- List packages in Agent Designer.
- Toggle package selection for Custom Agents.
- Add/remove/edit can remain CLI-only unless already simple in existing Chat Web patterns.

## Implementation Phases

### Phase 0: Boundary Check

Verify:

- `git status --short` in `<HOME>/code/pi-mono` is clean before and after.
- No implementation edits occur outside `<HOME>/code/pibo`.
- The dependency APIs available from `node_modules/@mariozechner/pi-coding-agent` are inspected.

Success:

- The implementer can state which public API will be used for runtime loading, or identify the blocker.

### Phase 1: Store, Types, Metadata

Implement:

- `src/pi-packages/types.ts`
- `src/pi-packages/store.ts`
- `src/pi-packages/metadata.ts`

Tests:

- parse valid `pi.dev` URL.
- reject non-`pi.dev` URL.
- reject `https://pi.dev/packages` without name.
- inspect local package with `package.json`.
- upsert/list/find/remove package store records.

Run:

```bash
npm run build
node --test test/pi-packages.test.mjs
```

### Phase 2: CLI

Implement:

- `src/pi-packages/cli.ts`
- route from `src/cli.ts`.

Tests:

- progressive help does not dump schema.
- `add`, `list`, `inspect`, `remove`, `doctor` use Pibo store only.
- invalid URL errors are clear.

Run:

```bash
node --test test/tools-cli.test.mjs
node --test test/pi-packages.test.mjs
```

### Phase 3: Profile and Custom Agent Selection

Implement:

- profile builder support in `src/core/profiles.ts`.
- Custom Agent persistence in `src/apps/chat/agent-store.ts`.
- profile creation in `src/apps/chat/agent-profiles.ts`.
- Capability Catalog extension in plugin registry/types.

Tests:

- Custom Agent saves and reloads `piPackages`.
- unknown package selection is rejected.
- catalog includes registered packages.

Run:

```bash
node --test test/agent-store.test.mjs
node --test test/plugin-registry.test.mjs
```

### Phase 4: Runtime Bridge

Implement:

- `src/pi-packages/installer.ts`.
- `src/pi-packages/runtime.ts`.
- integration in `src/core/runtime.ts`.

Tests:

- local dummy Pi package selected by Profile A is passed to runtime bridge.
- Profile B without selection does not load it.
- missing package produces diagnostic, not crash.
- runtime integration does not alter Pibo native tools, MCP selection, subagents, or run-control.

Run:

```bash
node --test test/channel-runtime.test.mjs
node --test test/subagents.test.mjs
node --test test/mcp-agent-context.test.mjs
```

If runtime loading is blocked by public dependency API limitations, commit the store/profile/CLI work and add diagnostics/tests proving the blocked runtime state.

### Phase 5: Chat Web API and UI

Implement:

- API routes in `src/apps/chat/web-app.ts`.
- frontend types in `src/apps/chat-ui/src/types.ts`.
- API client in `src/apps/chat-ui/src/api.ts`.
- Agent Designer package toggles in `src/apps/chat-ui/src/App.tsx`.

Tests:

- web API list/add/inspect/delete.
- Custom Agent payload accepts selected registered packages.
- UI typecheck passes.

Run:

```bash
npm run chat-ui:typecheck
npm run web-ui:build
node --test test/web-channel.test.mjs
```

### Phase 6: Diagnostics and Hardening

Implement:

- `doctor` checks store integrity, missing paths, install status, and resource discovery.
- runtime diagnostics for selected but unavailable packages.
- warnings for packages with no discovered resources.
- warnings for discovered tool names that may collide with Pibo-native tools.

Tests:

- broken JSON store.
- removed local path.
- package with no manifest/resources.
- selected package with install error.

## Acceptance Criteria

- A user can register `https://pi.dev/packages/pi-web-access` through Pibo.
- A user can register a local Pi Package path through Pibo.
- Registered packages are persisted in `.pibo/pi-packages.json`.
- Registered packages appear in the Capability Catalog.
- Custom Agents can persist selected package IDs.
- Runtime loading uses only package selections from the active Pibo profile.
- Pibo native MCP, subagents, run-control, and provider-backed tools still work.
- All package diagnostics are visible through CLI and runtime/profile inspection.
- `git status --short` in `<HOME>/code/pi-mono` remains unchanged.

## Verification Commands

Minimum final verification:

```bash
git -C <HOME>/code/pi-mono status --short
npm run build
npm run typecheck
node --test test/pi-packages.test.mjs
node --test test/agent-store.test.mjs
node --test test/plugin-registry.test.mjs
node --test test/channel-runtime.test.mjs
node --test test/web-channel.test.mjs
```

Add targeted tests as implementation touches more surfaces.

## Handoff Notes for the Next Session

Start by inspecting existing Pibo-only partial implementation:

```bash
rg -n "piPackages|pi-packages|PiboPiPackage" src test
```

Then verify the public dependency surface:

```bash
rg -n "PackageManager|DefaultPackageManager|extensionFactories|resourceLoaderOptions" node_modules/@mariozechner/pi-coding-agent/dist -g "*.d.ts"
```

Do not inspect or edit `<HOME>/code/pi-mono` unless a read-only reference is necessary. If read-only reference is used, state that no source modification is allowed before continuing.

The correct shape of the solution is a Pibo-owned wrapper around Pi Coding Agent package loading, not a Pi Coding Agent source change.
