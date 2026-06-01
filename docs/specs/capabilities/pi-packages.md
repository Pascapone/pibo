# Spec: Pibo Pi Packages

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`, `docs/specs/capabilities/custom-agents.md`

## Why

Pibo profiles need a controlled way to load Pi Coding Agent package resources without hard-coding every extension, skill, prompt, or theme into Pibo plugins. Operators need a small CLI for registering packages, and Chat Web users need settings and Agent Designer catalog entries so custom agents can select those packages.

Pi Packages are product-managed registrations. They record source, install state, discovered resources, diagnostics, and enablement. Runtime loading remains opt-in per profile or custom agent.

## Goal

Pibo MUST register, inspect, expose, select, and load Pi Coding Agent packages only through explicit Pibo Pi Package records and profile selections.

## Background / Current State

The implementation lives under `src/pi-packages/`. The store persists `.pibo/pi-packages.json`. The CLI is `pibo pi-packages`. Package metadata is discovered by `inspectPiPackageSource()`, installed or resolved by `installOrResolvePiPackage()`, listed in the capability catalog through `PiboPluginRegistry`, selected by custom agents, and converted into Pi runtime extension paths by `getPiPackageRuntimeOptions()`.

Chat Web exposes package APIs under `/api/chat/pi-packages` and shows package management in Settings. Custom agents validate package ids before saving and pass selected ids into runtime profile creation.

## Scope

### In Scope

- Local `.pibo/pi-packages.json` package registration store.
- CLI list, add, inspect, remove, and doctor commands.
- `https://pi.dev/packages/...` URL parsing for npm-backed packages.
- Local path parsing for CLI/local store workflows.
- npm package installation into `.pibo/pi-packages/npm/*`.
- Local package resolution without copying source files.
- Resource discovery for extensions, skills, prompts, and themes.
- Diagnostics, install status, and global enablement.
- Chat Web package list, add, enable/disable, and delete APIs.
- Agent Designer catalog exposure and custom-agent package selection.
- Runtime loading of selected installed and enabled packages.

### Out of Scope

- Publishing packages to `pi.dev` or npm.
- Editing package source code from Pibo.
- Chat Web local-path package registration; current web adds require `https://pi.dev/packages/...` sources.
- Automatically selecting registered packages for every profile.
- Rich dependency auditing beyond install/discovery diagnostics.
- Loading package resources that are not supported by Pi Coding Agent's package resolver.

## Requirements

### Requirement: Package registrations are durable local product records

The system MUST store registered Pi Packages in a local Pibo store with stable ids, source metadata, resource metadata, install state, enablement, diagnostics, and timestamps.

#### Current

`loadPiPackageStore()` and `savePiPackageStore()` read and write `.pibo/pi-packages.json` with `version: 1` and sanitized package entries.

#### Acceptance

- Missing stores read as an empty package list.
- Invalid store shape fails clearly instead of returning corrupted package data.
- Upsert creates `.pibo/pi-packages/npm`, `.pibo/pi-packages/git`, and `.pibo/pi-packages/local` directories when needed.
- Packages can be found by id, name, source, or install spec.
- Legacy entries with `installed: true` load as `installStatus: "installed"` and default to enabled.
- Package lists are sorted by name after upsert.

#### Scenario: Register local package metadata

- GIVEN a local package inspection returns id `demo-package`
- WHEN Pibo upserts that package
- THEN `.pibo/pi-packages.json` contains a versioned package record with install status, diagnostics, resource types, `addedAt`, and `updatedAt`.

### Requirement: Source parsing accepts only supported sources

The system MUST parse package sources into a supported install kind before attempting install or metadata discovery.

#### Current

`parsePiPackageSource()` accepts `https://pi.dev/packages/<name>` URLs as npm packages and existing local filesystem paths as local packages.

#### Acceptance

- Empty sources are rejected.
- Non-`pi.dev` URLs are rejected.
- `https://pi.dev/packages` index URLs are rejected.
- Scoped package URLs such as `https://pi.dev/packages/@scope/name` are accepted.
- Local sources resolve relative to the current working directory and must exist.
- Parsed npm sources store `installSpec` as `npm:<packageName>`.
- Parsed local sources store absolute path source and install spec values.

#### Scenario: Reject unsupported URL

- GIVEN a source `https://example.com/packages/tool`
- WHEN the CLI parses the source
- THEN parsing fails before any install command runs.

### Requirement: Package inspection discovers install state and resources

The system MUST inspect a supported source, install or resolve it, read package metadata, discover Pi resources, and return diagnostics.

#### Current

`inspectPiPackageSource()` reads npm metadata when available, reads local `package.json`, calls Pi Coding Agent package resolution, and records resource names and paths.

#### Acceptance

- Local package paths that exist resolve as installed with `installPath` equal to the local path.
- npm-backed packages are installed under `.pibo/pi-packages/npm/<encoded-package>/node_modules/<package>`.
- npm install timeout or failure records `installStatus: "error"` with diagnostics.
- Missing install output records `installStatus: "missing"`.
- Resource types include discovered extensions, skills, prompts, and themes.
- Packages with no discovered resources receive a warning diagnostic.

#### Scenario: Discover local resources

- GIVEN a local package has `pi.extensions` and `pi.skills` entries
- WHEN Pibo inspects the package
- THEN the registration contains `resourceTypes` including `extension` and `skill` plus discovered extension paths and skill names.

### Requirement: CLI package management is progressively discoverable

The `pibo pi-packages` CLI MUST expose compact discovery output and focused commands for local operator workflows.

#### Current

`runPiPackagesCli()` prints a small command surface for empty or help invocations and implements `list`, `add`, `inspect`, `remove`, and `doctor`.

#### Acceptance

- `pibo pi-packages` and `pibo pi-packages --help` list immediate commands and a next step.
- `list` prints an empty state with an add hint when no packages are registered.
- `add <source>` inspects and upserts the source, then prints source, install spec, status, and inspect hint.
- `inspect <name-or-id>` prints the stored package JSON or fails for unknown packages.
- `remove <name-or-id>` deletes only the matching registration.
- `doctor` reports current source/path problems and stored diagnostics.

#### Scenario: Local CLI registration

- GIVEN a local package path with a valid `package.json`
- WHEN an operator runs `pibo pi-packages add <path>` and then `pibo pi-packages list`
- THEN the list output shows the package name, install status, resource types, and install spec.

### Requirement: Chat Web manages packages through authenticated settings APIs

Chat Web MUST expose package management APIs that require authentication and same-origin JSON for mutations.

#### Current

`/api/chat/pi-packages` supports `GET` and `POST`; `/api/chat/pi-packages/:id` supports `GET`, `PATCH`, and `DELETE`.

#### Acceptance

- List and read routes require an authenticated web session.
- Create, update, and delete routes require same-origin JSON requests.
- Web create and source update accept only `https://pi.dev/packages/...` URLs.
- Enabling or disabling requires a boolean `enabled` value.
- Successful mutations invalidate the bootstrap/agent catalog cache.
- Deleting an unknown package returns not found.
- Deleting a package selected by any custom agent fails with conflict and names affected profiles.

#### Scenario: Block delete while selected

- GIVEN package `pkg-a` is selected by custom agent `review-agent`
- WHEN a user tries to delete `pkg-a` through Chat Web
- THEN the request fails with conflict and the package remains registered.

### Requirement: Package catalog entries do not activate packages by themselves

The system MUST expose registered packages in the capability catalog for inspection and selection without loading them into runtimes unless a profile selects them.

#### Current

`PiboPluginRegistry.getCapabilityCatalog()` returns `piPackages: listPiPackages()`. Profile metadata serializes selected package ids separately.

#### Acceptance

- The agent catalog includes all registered package records and current enabled status.
- Plugin profiles do not automatically select every registered package.
- Read-only profile metadata reports only packages selected by that profile.
- Agent Designer can show installed and enabled packages as selectable inputs.

#### Scenario: Registered package is visible but inactive

- GIVEN a package is registered in the local store
- WHEN the capability catalog is built for a profile that did not select it
- THEN the catalog lists the package, but the profile's selected package list is empty.

### Requirement: Custom agents validate and persist selected package ids

Custom agents MUST store package selections only when the selected packages are registered.

#### Current

`CustomAgentStore` normalizes `piPackages`, de-duplicates them, and rejects unknown ids through `findPiPackage()`.

#### Acceptance

- Duplicate package ids are stored once.
- Unknown package ids are rejected on create and update.
- Stored package selections survive gateway restart through the custom-agent store.
- Profile construction converts stored package ids to runtime profile package selections.

#### Scenario: Unknown package selection fails

- GIVEN no package `missing-package` exists
- WHEN a user saves a custom agent selecting `missing-package`
- THEN the save fails and no package selection is persisted.

### Requirement: Runtime loading is opt-in, installed, enabled, and diagnostic

The runtime MUST load only selected packages that are registered, globally enabled, installed, and backed by an existing runtime path.

#### Current

`getPiPackageRuntimeOptions()` reads selected profile packages, finds registered records, skips disabled/error/missing packages with diagnostics, and returns `additionalExtensionPaths` for Pi Coding Agent resource loading.

#### Acceptance

- Profiles with no selected packages add no package extension paths.
- Unknown selected package ids produce error diagnostics and are skipped.
- Globally disabled selected packages produce warning diagnostics and are skipped.
- Packages in `error` state produce error diagnostics and are skipped.
- Uninstalled packages without runtime paths produce warning diagnostics and are skipped.
- Installed packages whose paths do not exist produce error diagnostics and are skipped.
- Loaded package paths are de-duplicated before passing to Pi Coding Agent.

#### Scenario: Disabled selected package

- GIVEN a custom agent selects package `pkg-a`
- AND `pkg-a` is globally disabled
- WHEN Pibo creates a runtime for that agent
- THEN no extension path is added for `pkg-a` and a warning diagnostic says it was globally disabled.

### Requirement: Failed refresh preserves a previous installed record

The system SHOULD keep a previously installed package registration when a later refresh fails, while surfacing the refresh failure as diagnostics.

#### Current

`upsertPiPackage()` keeps the existing installed record if the new package input has `installStatus: "error"`, merging a warning and the new diagnostics.

#### Acceptance

- An installed package is not replaced by a failed refresh record.
- The package `updatedAt` changes after the failed refresh.
- Diagnostics include a warning that the latest refresh failed and the previous installed record was kept.
- Runtime loading can still use the previous installed path when it remains valid and enabled.

#### Scenario: npm refresh fails after prior install

- GIVEN package `pkg-a` is installed with a valid install path
- WHEN a later refresh of `pkg-a` returns install status `error`
- THEN Pibo preserves the installed path and records the refresh error diagnostics.

## Edge Cases

- A registered package can be removed from disk after registration; runtime loading must skip it and report a missing-path diagnostic.
- A package can expose only skills, prompts, or themes; runtime loading still passes the package root as an extension source for Pi package resolution.
- Web registration is intentionally stricter than CLI registration: web accepts package URLs only, while CLI accepts local paths.
- A package can be globally disabled while still selected by custom agents; selection remains saved, but runtime loading skips it.
- Stored diagnostics may contain errors from discovery even when a package has a usable install path; runtime diagnostics downgrade stored package errors to warnings after loading.

## Constraints

- **Product Boundary:** Pibo owns package registrations, selection, enablement, diagnostics, and catalog exposure. Pi Coding Agent owns resource loading semantics.
- **Security / Privacy:** Chat Web package mutations MUST require authenticated same-origin JSON requests. Web package registration MUST NOT accept arbitrary local paths in the current UI/API.
- **Compatibility:** Existing legacy store entries with `installed: true` remain readable and default to enabled.
- **Reliability:** Runtime creation MUST skip unusable packages with diagnostics instead of crashing the whole session when possible.
- **Context Economy:** Packages are loaded only when selected by a profile or custom agent; registration alone does not expand runtime context.

## Success Criteria

- [ ] SC-001: `pibo pi-packages --help`, `list`, `add`, `inspect`, `remove`, and `doctor` work against the local store.
- [ ] SC-002: `https://pi.dev/packages/...` sources and existing local paths parse correctly, while unsupported URLs fail.
- [ ] SC-003: Package inspection records install status, resource types, discovered names/paths, diagnostics, and timestamps.
- [ ] SC-004: Chat Web can list, add, enable/disable, and delete packages with auth and same-origin mutation checks.
- [ ] SC-005: Deleting a package selected by custom agents is blocked until those selections are removed.
- [ ] SC-006: Custom-agent package selections reject unknown package ids and de-duplicate known ids.
- [ ] SC-007: Runtime creation loads only selected, enabled, installed packages with existing paths and reports diagnostics for skipped selections.
- [ ] SC-008: A failed refresh does not destroy a previously installed usable package registration.

## Assumptions and Open Questions

### Assumptions

- `.pibo/pi-packages.json` is the local source of truth for registered Pi Packages.
- Package selection belongs to profiles/custom agents, not to the global package registration itself.
- Web registration is limited to `pi.dev` package URLs to avoid exposing arbitrary server filesystem paths through Chat Web.

### Open Questions

- Should Chat Web eventually support local package registration through a safer file-picker or trusted-operator mode?
- Should Pi Package enablement become app-spaced instead of global to the local Pibo home?
- Should package install and refresh run as yielded jobs so long npm installs do not block web requests?
- Should package resource discovery distinguish extension packages from packages that contain only skills/prompts/themes at runtime load time?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Package registrations are durable local product records | Register local package metadata | `src/pi-packages/store.ts`, `test/pi-packages.test.mjs` | Implemented |
| REQ-002 Source parsing accepts only supported sources | Reject unsupported URL | `src/pi-packages/metadata.ts`, `test/pi-packages.test.mjs` | Implemented |
| REQ-003 Package inspection discovers install state and resources | Discover local resources | `src/pi-packages/metadata.ts`, `src/pi-packages/installer.ts`, `test/pi-packages.test.mjs` | Implemented |
| REQ-004 CLI package management is progressively discoverable | Local CLI registration | `src/pi-packages/cli.ts`, `src/cli.ts`, `test/pi-packages.test.mjs` | Implemented |
| REQ-005 Chat Web manages packages through authenticated settings APIs | Block delete while selected | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/api.ts`, `test/web-channel.test.mjs` | Implemented |
| REQ-006 Package catalog entries do not activate packages by themselves | Registered package is visible but inactive | `src/plugins/registry.ts`, `test/plugin-registry.test.mjs` | Implemented |
| REQ-007 Custom agents validate and persist selected package ids | Unknown package selection fails | `src/apps/chat/agent-store.ts`, `src/apps/chat/agent-profiles.ts`, `test/agent-store.test.mjs` | Implemented |
| REQ-008 Runtime loading is opt-in, installed, enabled, and diagnostic | Disabled selected package | `src/pi-packages/runtime.ts`, `src/core/runtime.ts`, `test/pi-packages.test.mjs` | Implemented |
| REQ-009 Failed refresh preserves a previous installed record | npm refresh fails after prior install | `src/pi-packages/store.ts` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/pi-packages.test.mjs`, `test/plugin-registry.test.mjs`, `test/agent-store.test.mjs`, `test/agent-profiles.test.mjs`, `test/session-router-store.test.mjs`, and `test/web-channel.test.mjs`.
