# Spec: Pibo Home and Workspace State Layout

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Local Config CLI](./local-config-cli.md), [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Runtime Prompt and Compaction Configuration](./runtime-prompt-and-compaction.md), [Pibo Runtime Assembly and Profile Inspection](./pibo-runtime-assembly-and-inspection.md), [Pibo Pi Packages](./pi-packages.md)

## Why

Pibo stores both user-wide product state and workspace-local runtime customization. Agents and operators need predictable paths so they can inspect, back up, isolate, and debug Pibo without mixing global account data with repository-local agent configuration.

The current code uses two storage roots: a Pibo home directory for controller-wide product services, and each runtime workspace's `.pibo/` directory for workspace-scoped prompt and package state. This spec captures that boundary as a durable behavior contract.

## Goal

Pibo MUST resolve product-wide state under `PIBO_HOME` or the default home directory, while resolving workspace-scoped runtime state under the effective workspace, without silently crossing those boundaries.

## Background / Current State

`src/core/pibo-home.ts` resolves Pibo home as `process.env.PIBO_HOME` or `~/.pibo`. Multiple stores use `piboHomePath(...)` for SQLite databases, payload roots, context files, managed tool runtimes, and user settings. `src/core/workspace.ts` resolves a default runtime workspace from the OS home directory, falling back to `process.cwd()` when the home directory is unavailable.

Workspace-local files are intentionally separate. Runtime prompts and Pi packages use `<workspace>/.pibo/...` paths. Routed sessions persist the selected workspace on each Pibo Session so later runtime creation, traces, downloads, and room or project workflows can resolve relative workspace behavior consistently.

## Scope

### In Scope

- Resolution of Pibo home from `PIBO_HOME` or `~/.pibo`.
- Default workspace resolution for local and routed runtime creation.
- Separation of product-wide stores from workspace-local `.pibo/` state.
- Directory creation, SQLite write-ahead logging, and in-memory store exceptions where implemented.
- Persistence of effective workspace on Pibo Session records.
- Debuggability expectations for path discovery.

### Out of Scope

- The schema of each SQLite store — covered by store-specific specs.
- Prompt markdown content and compaction behavior — covered by runtime prompt specs.
- Pi package install metadata semantics — covered by the Pi package spec.
- OS-level backup, encryption, or retention policy beyond current path behavior.

## Requirements

### Requirement: Pibo home is deterministic and overridable

The system MUST resolve product-wide Pibo home to `PIBO_HOME` when the environment variable is set, and otherwise to `<os-home>/.pibo`.

#### Current

`getPiboHome()` returns `process.env.PIBO_HOME || join(homedir(), ".pibo")`.

#### Target

All product-wide default paths use this resolver or an equivalent resolver with the same precedence.

#### Acceptance

- With `PIBO_HOME=/tmp/pibo-x`, the default config path is `/tmp/pibo-x/config.json`.
- Without `PIBO_HOME`, the default config path is `<homedir>/.pibo/config.json`.
- Product-wide default paths do not depend on `process.cwd()` unless an API explicitly accepts a custom path.

#### Scenario: Isolated test home

- GIVEN `PIBO_HOME` points at a temporary directory
- WHEN Pibo initializes config, sessions, data, cron, auth, reliability, or user settings with default paths
- THEN those files are created under that temporary directory, not under the real user home

### Requirement: Product-wide stores live under Pibo home by default

The system MUST keep controller-wide product services in Pibo home unless a caller passes an explicit path.

#### Current

Default constructors and helpers use Pibo home paths for `config.json`, `auth.sqlite`, `pibo-sessions.sqlite`, `pibo.sqlite`, `payloads/`, `pibo-events.sqlite`, `pibo-cron.sqlite`, `chat-agents.sqlite`, model defaults, managed context files, tool runtimes, and user settings.

#### Target

A default gateway or Chat Web instance can be inspected by locating its Pibo home, then looking for product service state under that root.

#### Acceptance

- Default SQLite-backed stores create parent directories before opening a database file.
- Persistent SQLite-backed stores set `busy_timeout` and use WAL mode where current code does so.
- `:memory:` store paths remain in-memory and do not create filesystem directories.

#### Scenario: Fresh Pibo home

- GIVEN an empty Pibo home directory
- WHEN Chat Web or a routed gateway starts and opens its default stores
- THEN the required database files and payload directories are initialized under that Pibo home

### Requirement: Workspace state is local to the effective workspace

The system MUST write workspace-scoped runtime configuration under `<workspace>/.pibo/`, not under Pibo home.

#### Current

Base prompt state uses `<workspace>/.pibo/base-prompt.json` and `<workspace>/.pibo/base-prompt.md`. Compaction prompt state uses `<workspace>/.pibo/compaction-prompt.json` and `<workspace>/.pibo/compaction-prompt.md`. Pi package state uses `<workspace>/.pibo/pi-packages.json` plus install subdirectories.

#### Target

Copying or switching a workspace carries workspace-local runtime customization with that workspace, while product-wide account and gateway state remains in Pibo home.

#### Acceptance

- Saving a custom base prompt in workspace A does not create or update workspace B's `.pibo/base-prompt.*` files.
- Saving a custom compaction prompt in workspace A does not create or update Pibo home prompt files.
- Registering a Pi package in workspace A writes workspace A's `.pibo/pi-packages.json` and package subdirectories.

#### Scenario: Two workspaces with different prompts

- GIVEN two workspaces and one Pibo home
- WHEN each workspace selects a different base prompt mode
- THEN runtime creation in each workspace uses that workspace's prompt state independently

### Requirement: Default workspace is stable for runtimes

The system MUST choose a default runtime workspace from the OS home directory when available, and fall back to the current process directory only when no home directory is available.

#### Current

`getDefaultPiboWorkspace()` returns `homedir()` when non-empty, otherwise `process.cwd()`.

#### Target

Local clients, session routers, and scheduled jobs have a deterministic workspace even when no room or session workspace is supplied.

#### Acceptance

- If `homedir()` is non-empty, new default runtime sessions use that directory when no explicit workspace is supplied.
- If `homedir()` is empty, new default runtime sessions use `process.cwd()`.
- A stored session workspace takes precedence over router or process defaults when the runtime is recreated.

#### Scenario: Scheduled job without explicit workspace

- GIVEN a scheduled job targets a room without a room workspace
- WHEN the job creates a routed session
- THEN the session workspace is the default Pibo workspace and is persisted on the created Pibo Session

### Requirement: Pibo Sessions persist effective workspace identity

The system MUST store the workspace associated with a Pibo Session and use it for subsequent routed runtime behavior.

#### Current

Session stores include a `workspace` column. The router updates session records with the current runtime cwd and creates child sessions using the parent workspace when applicable.

#### Target

Session resume, fork, clone, subagent delegation, trace metadata, file download, and room/project workflows can resolve workspace-relative behavior from the Pibo Session record.

#### Acceptance

- Creating or updating a Pibo Session can persist `workspace`.
- Updating a session with `workspace: null` clears the stored workspace.
- Runtime creation uses the stored session workspace before router-level or default workspace options.
- Child routed sessions inherit the parent workspace unless a more specific workflow supplies one.

#### Scenario: Resume session after gateway restart

- GIVEN a routed session persisted workspace `/work/project-a`
- WHEN the gateway restarts and receives input for that Pibo Session
- THEN the runtime is recreated with `/work/project-a` as its cwd

### Requirement: Path APIs create only their managed directories

The system MUST create parent directories only for the store or workspace state it owns, and MUST NOT create unrelated source or user directories as a side effect of path resolution alone.

#### Current

Store constructors and save functions create parent directories immediately before writing or opening their own files. Project creation may create a requested project folder only when the create-folder option is used. Room workspace validation requires existing absolute directories.

#### Target

Path resolution is safe to call for discovery, and writes create only the minimum directories required by the requested operation.

#### Acceptance

- Loading a missing JSON config or model-defaults file returns an empty/default object and does not write a file.
- Saving config, model defaults, prompts, Pi package store, or opening a persistent SQLite store creates only that file's parent directories.
- Room workspace APIs reject relative, missing, or non-directory paths instead of creating them.

#### Scenario: Read-only discovery

- GIVEN a missing Pibo config file
- WHEN code loads default config
- THEN it returns `{}` without creating `config.json`

### Requirement: Path discovery is operator-visible

The system SHOULD expose enough path information through operator and debug surfaces for agents to locate the active Pibo home and stores.

#### Current

The debug CLI prints the active Pibo home, store diagnostics resolve default store paths under Pibo home, and local config help includes the default config path.

#### Target

An agent can discover where Pibo is reading and writing product state without inspecting source code first.

#### Acceptance

- `pibo debug` discovery output includes the active Pibo home.
- Store diagnostics report default store paths resolved through Pibo home.
- Config CLI discovery names the default config path.

#### Scenario: Agent diagnoses wrong home

- GIVEN a gateway is started with an unexpected `PIBO_HOME`
- WHEN an agent runs debug discovery
- THEN the output reveals the active Pibo home path needed for further inspection

## Edge Cases

- `PIBO_HOME` may be relative in the environment; current path joining behavior preserves that caller choice unless a downstream store resolves it.
- Store constructors that accept explicit paths may place data outside Pibo home by design.
- `:memory:` SQLite stores are valid for tests and must not create directories.
- Corrupt JSON handling differs by store: some loaders return defaults, while strict stores throw for unsupported formats.
- Legacy prompt override files such as `<workspace>/.pibo/SYSTEM.md` can affect active base prompt selection without changing the path-boundary rule.

## Constraints

- **Compatibility:** Existing Pibo homes and workspace `.pibo/` directories must remain readable.
- **Security / Privacy:** Pibo home may contain auth, provider, user, and session data; specs and logs should avoid exposing secrets or hard-coded server addresses.
- **Performance:** SQLite-backed persistent stores should keep current bounded busy timeout and WAL behavior where implemented.
- **Dependencies:** Path behavior depends on Node `os.homedir()`, `process.env.PIBO_HOME`, and explicit path arguments supplied by callers.

## Success Criteria

- [ ] SC-001: A test can set `PIBO_HOME` and observe all default product stores under that directory.
- [ ] SC-002: A test can save workspace-local prompts or Pi packages in two workspaces without cross-writing state.
- [ ] SC-003: A routed session created with an explicit workspace resumes with the same cwd after router recreation.
- [ ] SC-004: Missing config/model-default JSON loads do not create files, while save operations create only managed parent directories.
- [ ] SC-005: Debug or config discovery surfaces the active Pibo home or default config path.

## Assumptions and Open Questions

### Assumptions

- `PIBO_HOME` is an operator-controlled isolation boundary and may intentionally be outside the OS home directory.
- Workspace `.pibo/` state is part of the workspace and may be copied, discarded, or version-controlled according to project policy outside Pibo.
- Store-specific specs remain responsible for table schemas and retention behavior.

### Open Questions

- Should Pibo normalize `PIBO_HOME` to an absolute path at the resolver boundary for clearer diagnostics?
- Should there be one CLI command that lists all active product-wide and workspace-local paths in a machine-readable format?
- Should relative explicit paths supplied to store constructors remain resolved by each store, or be rejected for operator-facing commands?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Pibo home is deterministic and overridable | Isolated test home | Add or verify resolver tests | Pending |
| REQ-002 Product-wide stores live under Pibo home by default | Fresh Pibo home | Add default-store path coverage | Pending |
| REQ-003 Workspace state is local to the effective workspace | Two workspaces with different prompts | Add workspace isolation tests | Pending |
| REQ-004 Default workspace is stable for runtimes | Scheduled job without explicit workspace | Add scheduler/router workspace tests | Pending |
| REQ-005 Pibo Sessions persist effective workspace identity | Resume session after gateway restart | Add routed resume workspace test | Pending |
| REQ-006 Path APIs create only their managed directories | Read-only discovery | Add no-write load tests | Pending |
| REQ-007 Path discovery is operator-visible | Agent diagnoses wrong home | Add CLI snapshot/contract test | Pending |

## Verification Basis

This spec is based on current code in `src/core/pibo-home.ts`, `src/core/workspace.ts`, `src/config/config.ts`, `src/core/model-defaults.ts`, `src/core/base-prompt.ts`, `src/core/compaction-prompt.ts`, `src/sessions/sqlite-store.ts`, `src/data/pibo-store.ts`, `src/reliability/store.ts`, `src/cron/store.ts`, `src/apps/chat/agent-store.ts`, `src/auth/better-auth.ts`, `src/pi-packages/store.ts`, `src/core/session-router.ts`, `src/cron/service.ts`, `src/apps/chat/web-app.ts`, and `src/debug/index.ts`.
