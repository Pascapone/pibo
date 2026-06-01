# Spec: MCP Registry Python Runtimes

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [MCP Server Integration](./mcp-server-integration.md), [Pibo Home and Workspace State](./pibo-home-and-workspace-state.md)

## Why

Pibo's MCP registry is meant to turn known MCP server presets into usable local server configs. Some presets need a Python package and executable before they can be added to `mcp_servers.json`. That setup must be repeatable, inspectable, removable, and isolated under Pibo home so a preset does not depend on an operator's global Python environment beyond the bootstrap toolchain.

The current registry contains no bundled presets, but the code already defines the runtime contract used by future Python-backed entries. This spec captures that implemented behavior so future registry entries stay consistent.

## Goal

Pibo SHALL install, inspect, configure, and remove registry-managed Python MCP runtimes in deterministic Pibo-home locations, and SHALL fail with actionable CLI errors when required runtime tools are unavailable.

## Background / Current State

`src/mcp/registry.ts` defines registry actions for listing, showing, doctoring, installing, and removing built-in presets. Each registry entry may declare a `PythonRuntimeSpec` with package name, executable name, Python version, optional post-install arguments, server arguments, optional environment, and optional registry-sourced agent description.

`src/mcp/python-runtime.ts` stores runtime files under `${PIBO_HOME:-~/.pibo}/mcp-tools/<name>`, creates a `.venv` with `uv`, installs the configured Python package into that virtual environment, reports doctor status, and removes the runtime directory on registry removal.

## Scope

### In Scope

- Runtime path resolution for registry-managed Python MCP servers.
- Doctor output for `uv`, requested Python version, virtual environment, and executable presence.
- Installation through `uv venv` and `uv pip install`.
- Optional post-install executable invocation.
- Registry preset conversion into MCP stdio server config.
- `--no-setup` registry install behavior.
- Runtime removal during registry preset removal.
- CLI error shape for missing `uv` and failed setup commands.

### Out of Scope

- Bundling a concrete registry preset — the current registry is empty.
- Managing non-Python registry runtimes.
- Upgrading existing virtual environments in place.
- Verifying that an installed MCP server is semantically safe to call.
- Secret storage for registry server environment values.

## Requirements

### Requirement: Runtime paths are deterministic and Pibo-home scoped

The system MUST derive Python runtime paths from Pibo home, registry entry name, and platform conventions.

#### Current

`getPythonRuntimePaths()` uses `PIBO_HOME` when set, otherwise `~/.pibo`. It stores each runtime under `mcp-tools/<name>`, places the virtual environment in `.venv`, and resolves `pythonPath` and `executablePath` from `bin/` on POSIX or `Scripts/` on Windows.

#### Target

Operators and registry code can predict where a preset installs without reading global Python state or the current working directory.

#### Acceptance

- With `PIBO_HOME=/tmp/pibo`, preset `docs` stores files under `/tmp/pibo/mcp-tools/docs`.
- Without `PIBO_HOME`, runtime paths are under the user's home `.pibo/mcp-tools/<name>`.
- POSIX executables resolve without `.exe`; Windows executables resolve with `.exe`.
- The generated MCP server config command points at the runtime executable path.

#### Scenario: Build server config for preset

- GIVEN a registry entry named `docs` with executable `mcp-docs`
- WHEN Pibo builds the preset server config
- THEN the config uses the deterministic runtime executable path as its `command`.

### Requirement: Doctor reports prerequisites and install state

The registry doctor MUST report whether the Python runtime can be installed and whether it already exists.

#### Current

`printPythonRuntimeDoctor()` checks `uv --version`, checks `uv python find <pythonVersion>` only when `uv` exists, prints the runtime root, virtual environment presence, and executable presence, and prints install guidance when `uv` or the requested Python is missing.

#### Target

An operator can run `pibo mcp registry doctor <name>` before installation and see the next corrective action.

#### Acceptance

- Doctor output names the registry entry.
- Doctor output includes `uv`, requested Python version, runtime path, venv state, and executable state.
- If `uv` is missing, the output includes platform-specific `uv` install hints.
- If `uv` is present but the requested Python is missing, the output includes Python install hints and asks the operator to rerun doctor.

#### Scenario: Missing uv

- GIVEN `uv` is not on `PATH`
- WHEN an operator runs registry doctor for a Python-backed preset
- THEN the command does not attempt Python discovery
- AND it prints that Python discovery was skipped because `uv` is missing.

### Requirement: Install creates an isolated virtual environment

Registry installation with setup enabled MUST create the runtime directory, create a virtual environment with the requested Python version, and install the configured package into that environment.

#### Current

`installPythonRuntime()` first verifies `uv --version`, creates the runtime root directory, runs `uv venv <venvDir> --python <pythonVersion>`, then runs `uv pip install --python <pythonPath> <packageName>` with inherited stdio.

#### Target

A successful registry install produces a local executable that can be referenced by the MCP stdio server config.

#### Acceptance

- Missing `uv` fails before creating or mutating the virtual environment.
- Setup commands use inherited stdio so users can see installer progress and errors.
- A non-zero setup command fails the install with a structured client error.
- On success, the returned paths identify the runtime root, venv, Python path, and executable path.

#### Scenario: Package install fails

- GIVEN `uv` exists but `uv pip install` exits non-zero
- WHEN the operator installs the registry preset
- THEN Pibo reports a setup command failure
- AND suggests fixing the setup error before rerunning install.

### Requirement: Optional post-install commands run from the installed executable

If a registry entry declares post-install arguments, Pibo MUST run the installed executable with those arguments after package installation.

#### Current

`installPythonRuntime()` invokes `paths.executablePath` with `spec.postInstallArgs` when the argument list is present and non-empty.

#### Target

Presets can perform package-managed initialization steps without requiring a separate manual command.

#### Acceptance

- No post-install command runs when `postInstallArgs` is absent or empty.
- When present, Pibo runs the installed executable, not a global executable with the same name.
- A post-install failure fails the registry install with the same structured command-failed error path.

#### Scenario: Preset initializes cache

- GIVEN a preset declares `postInstallArgs: ["setup"]`
- WHEN registry install completes package installation
- THEN Pibo runs `<runtime executable> setup` before adding the MCP config.

### Requirement: Registry install adds config after optional setup

The registry install command MUST add a preset's MCP server config after setup succeeds, or immediately when setup is explicitly skipped.

#### Current

`installEntry()` calls `installPythonRuntime()` unless `runSetup === false`, then calls `configCommand({ action: "add", serverJson: JSON.stringify(buildServerConfig(entry)) })`.

#### Target

Operators can choose between full setup plus config insertion and config-only insertion for pre-provisioned runtimes.

#### Acceptance

- Default registry install runs setup before mutating MCP config.
- `pibo mcp registry install <name> --no-setup` skips virtual environment creation and still adds the generated server config.
- Generated configs include server args and optional environment values from the registry entry.
- Generated configs include a `pibo.description` with `descriptionSource: "registry"` when the entry has an agent description.

#### Scenario: Config-only install

- GIVEN a registry entry exists
- WHEN an operator installs it with `--no-setup`
- THEN Pibo adds the generated MCP server config
- AND does not run `uv` setup commands.

### Requirement: Removal deletes config and runtime files

Registry removal MUST remove both the MCP config entry and the local runtime directory for the preset.

#### Current

For registry removal, `registryCommand()` calls `configCommand({ action: "remove" })` and then `removePythonRuntime()`, which recursively removes the runtime root with `force: true` and prints the removed path.

#### Target

A removed registry preset leaves no Pibo-managed virtual environment files behind, even if the runtime directory is already missing.

#### Acceptance

- Removing a preset deletes its MCP server config entry.
- Removing a preset removes `${PIBO_HOME:-~/.pibo}/mcp-tools/<name>` recursively.
- Missing runtime directories do not make removal fail.
- Removal output reports the runtime path that was removed.

#### Scenario: Remove missing runtime

- GIVEN the MCP config contains a registry preset
- AND its runtime directory was already deleted
- WHEN an operator runs registry remove for that preset
- THEN Pibo removes the config entry and exits successfully.

### Requirement: Empty or unknown registry states are explicit

The registry command surface MUST distinguish an empty bundled registry from an unknown requested preset.

#### Current

The current `REGISTRY` array is empty. `registry list` prints that no entries are bundled. Actions that require a missing name fail with `MISSING_ARGUMENT`; unknown names fail with `MCP_REGISTRY_ENTRY_NOT_FOUND` and mention whether entries are available.

#### Target

Agents can discover that no preset exists today without treating it as a broken MCP installation.

#### Acceptance

- `pibo mcp registry list` succeeds and prints a clear empty-state message when no entries are bundled.
- `pibo mcp registry show|doctor|install|remove` without a name fails with a missing-argument error and a suggestion to list presets.
- Requests for an unknown preset fail with a registry-not-found error.
- When the registry is empty, the error details state that no entries are currently bundled.

#### Scenario: Empty registry list

- GIVEN the current code's empty registry
- WHEN an operator runs `pibo mcp registry list`
- THEN Pibo prints `No registry entries are currently bundled.` and does not treat it as a runtime error.

## Edge Cases

- A malformed registry entry with no executable name would produce unusable paths; bundled entries must be reviewed before release.
- `--no-setup` can add a config whose executable does not exist; the later MCP call will fail at connection time.
- Post-install commands inherit the operator environment and may require external credentials or network access.
- Removal is forceful and recursive under the preset runtime root; path construction must remain Pibo-home scoped.

## Constraints

- **Compatibility:** Registry install uses the existing `pibo mcp config add` behavior and must not bypass MCP config validation.
- **Security / Privacy:** Registry-generated configs may include environment variable references, but Pibo must not invent or persist secrets outside the config system.
- **Performance:** Doctor checks and setup commands are operator-triggered; they need not run during normal runtime creation.
- **Dependencies:** Python setup depends on `uv` being available on `PATH` and on the requested Python version being installable or discoverable by `uv`.

## Success Criteria

- [ ] SC-001: Unit tests cover Python runtime path resolution with and without `PIBO_HOME`.
- [ ] SC-002: Registry doctor tests cover missing `uv`, missing Python, missing venv, and missing executable output.
- [ ] SC-003: Registry install tests verify setup-before-config, `--no-setup`, generated server config fields, and registry-sourced descriptions.
- [ ] SC-004: Runtime install tests cover missing `uv`, failed `uv venv`, failed package install, and failed post-install command.
- [ ] SC-005: Registry removal tests verify config removal and recursive runtime deletion tolerate missing runtime paths.

## Assumptions and Open Questions

### Assumptions

- Future bundled registry entries will use the same `PythonRuntimeSpec` shape that exists in current code.
- Pibo intentionally delegates Python acquisition and package installation to `uv` instead of implementing package management directly.

### Open Questions

- Should future registry entries pin exact package versions or hashes for reproducibility?
- Should registry setup support upgrades or reinstalling an existing runtime without manual removal?
- Should Pibo expose a dry-run mode that prints the generated config and setup commands without executing them?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 Runtime paths are deterministic and Pibo-home scoped | Build server config for preset | `src/mcp/python-runtime.ts`, `src/mcp/registry.ts` | Draft |
| REQ-002 Doctor reports prerequisites and install state | Missing uv | `src/mcp/python-runtime.ts`, `src/mcp/registry.ts` | Draft |
| REQ-003 Install creates an isolated virtual environment | Package install fails | `src/mcp/python-runtime.ts` | Draft |
| REQ-004 Optional post-install commands run from the installed executable | Preset initializes cache | `src/mcp/python-runtime.ts` | Draft |
| REQ-005 Registry install adds config after optional setup | Config-only install | `src/mcp/registry.ts`, `src/mcp/config-command.ts` | Draft |
| REQ-006 Removal deletes config and runtime files | Remove missing runtime | `src/mcp/registry.ts`, `src/mcp/python-runtime.ts` | Draft |
| REQ-007 Empty or unknown registry states are explicit | Empty registry list | `src/mcp/registry.ts`, `src/mcp/errors.ts` | Draft |

## Verification Basis

This spec was refreshed against current source code in `src/mcp/registry.ts`, `src/mcp/python-runtime.ts`, `src/mcp/config-command.ts`, `src/mcp/config.ts`, and `src/mcp/errors.ts`. The current registry is still empty, so Python-backed preset behavior remains source-inspected until a bundled preset or focused registry runtime tests land.
