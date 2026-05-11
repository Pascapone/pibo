# Spec: Browser-use Authenticated Leases

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage  
**Related docs:** [Browser Automation Desktop Environment](./browser-automation-desktop-environment.md), [Curated CLI Tools](./curated-cli-tools.md), [Docker Compute Workers](./docker-compute-workers.md), `AGENTS.md`

## Why

Agents need authenticated browser sessions for Chat Web checks without sharing a live Chrome profile, corrupting template state, or racing other agents. The browser-use lease system gives agents short-lived, isolated Chrome user-data directories copied from a prepared authenticated template.

This capability keeps authentication setup outside the runtime prompt while still making the safe workflow discoverable through `pibo tools browser-use`.

## Goal

Pibo MUST provide a local browser-use auth pool that can prepare a reusable authenticated template, acquire isolated browser slots, expose shell exports for each slot, and release or reap slots without touching the host gateway or another agent's active browser profile.

## Background / Current State

The current implementation is centered on `src/tools/browser-use-leases.ts` and the `browser-use` command branch in `src/tools/index.ts`. Lease state is stored under the installed browser-use tool home in `auth-pool/leases.json`. Slot profiles are copied from a template profile, excluding transient Chrome lock and DevTools files. Lease acquire prints environment exports by default and can print JSON for machine callers.

The lease system complements, but is distinct from, the desktop and CDP health behavior covered by the Browser Automation Desktop Environment spec. That spec covers display detection, target discovery, and health summaries. This spec covers authenticated template and lease lifecycle behavior.

## Scope

### In Scope

- `pibo tools browser-use` progressive discovery for auth-template, target, attach, health, and lease commands.
- Auth template path and environment export commands.
- Lease acquisition from a template Chrome profile into isolated slot directories.
- Lease registry locking, slot naming, TTLs, owner labels, maximum active slot limits, and JSON/text output.
- Warm-up of acquired slots through the browser-use wrapper.
- Listing, releasing, deleting slot profiles, and reaping expired active leases.
- Safety checks that prevent copying a running template profile.

### Out of Scope

- Creating the web application login itself — users or agents authenticate in the template browser.
- Managing Better Auth sessions or dev-auth policy — covered by web auth and Docker worker specs.
- General Chrome CDP target probing and Chat tab selection — covered by browser automation desktop behavior.
- Remote or multi-host lease coordination; the current registry is local to the browser-use tool home.

## Requirements

### Requirement: Browser-use auth commands are progressively discoverable

The CLI MUST expose browser-use auth helpers without loading long browser automation instructions into every runtime.

#### Current

`pibo tools browser-use` prints a compact command surface. Nested `auth-template` and `lease` commands print only their immediate actions. The curated tool catalog snippet points agents to `tools env browser-use` and `tools browser-use lease acquire`.

#### Acceptance

- `pibo tools browser-use` lists `targets`, `attach-chat`, `auth-template`, `lease`, and `health`.
- `pibo tools browser-use auth-template` lists `path` and `env` only.
- `pibo tools browser-use lease` lists `acquire`, `list`, `release <id>`, and `reap-stale` only.
- The main browser-use guide remains reachable through `pibo tools guide browser-use browser-use`.

#### Scenario: Agent discovers a safe auth workflow

- GIVEN an agent has only the top-level tools command
- WHEN it runs `pibo tools browser-use`
- THEN the output points to environment setup, target inspection, auth-template preparation, and lease acquisition without starting a browser by itself.

### Requirement: Auth template exports target a reusable closed Chrome profile

The auth-template commands MUST identify the template user-data directory and print environment exports that let an operator prepare it with browser-use.

#### Current

`auth-template path` prints the default template directory, overridable with `PIBO_BROWSER_USE_AUTH_TEMPLATE_DIR`. `auth-template env` creates the directory and exports `BROWSER_USE_HOME`, `PIBO_BROWSER_USE_SESSION=pibo-auth-template`, `PIBO_BROWSER_USE_CHROME_USER_DATA_DIR`, and `PIBO_BROWSER_USE_DEFAULT_PROFILE`.

#### Acceptance

- Template env output is shell-evaluable on Unix shells.
- Template env output never uses the active default browser-use profile as a fallback template.
- The template directory exists after `auth-template env` completes.
- The printed comment shows the next browser-use command shape for opening the Chat Web URL.

#### Scenario: Prepare authenticated template

- GIVEN browser-use is installed
- WHEN an operator runs `eval "$(pibo tools browser-use auth-template env)"` and signs in through browser-use
- THEN the resulting Chrome profile can be closed and later cloned into isolated lease slots.

### Requirement: Lease acquisition clones template state into isolated slots

The acquire command MUST allocate a lease id, copy the configured template profile into a slot directory, and expose the exact environment needed to use that slot.

#### Current

`lease acquire` chooses an app-scoped slot id such as `pibo-chat-slot-001`, copies the template to `auth-pool/<app>/slot-NNN`, skips `Singleton*` and `DevToolsActivePort`, stores the lease in `leases.json`, and prints exports for `BROWSER_USE_HOME`, `PIBO_BROWSER_USE_LEASE_ID`, `PIBO_BROWSER_USE_SESSION`, `PIBO_BROWSER_USE_CHROME_USER_DATA_DIR`, and `PIBO_BROWSER_USE_DEFAULT_PROFILE`.

#### Acceptance

- Slot ids are deterministic per app and use sanitized app names.
- Acquired leases include app, owner, session name, profile name, user-data dir, status, timestamps, and expiry.
- Copied profiles preserve authentication files such as cookies.
- Transient Chrome lock and DevTools files are not copied.
- `--json` returns the lease record plus an `exports` object instead of shell exports.

#### Scenario: Acquire isolated Chat Web slot

- GIVEN a closed authenticated template profile contains a cookie file
- WHEN an agent runs `pibo tools browser-use lease acquire --app pibo-chat --owner agent-a --template-dir <template>`
- THEN Pibo creates `pibo-chat-slot-001`, copies the cookie into that slot, omits transient Chrome files, and prints shell exports for the isolated browser-use session.

### Requirement: Active lease counts and registry writes are concurrency-safe

Lease mutations MUST serialize access to the local registry and enforce maximum active slot limits before creating new slots.

#### Current

The lease system uses an `auth-pool/.leases.lock` directory with bounded retries around registry reads and writes. `--max-slots` counts active, non-expired leases for the requested app before allocating a new slot.

#### Acceptance

- Concurrent acquire, release, and reap operations do not write partial or conflicting registry files.
- A lock wait that cannot be satisfied fails clearly instead of proceeding unlocked.
- When `--max-slots` would be exceeded, acquire fails with `BROWSER_USE_AUTH_POOL_EXHAUSTED` and suggests releasing a lease or increasing the limit.
- Released or expired leases whose browser process is not alive can be reused for the same app.

#### Scenario: Pool is full

- GIVEN one active non-expired lease exists for app `pibo-chat`
- WHEN an agent runs acquire with `--app pibo-chat --max-slots 1`
- THEN Pibo rejects the request and does not create or copy another slot directory.

### Requirement: Running template profiles are not cloned

The system MUST refuse to copy a template profile that appears to be open in Chrome.

#### Current

Before copying an existing template profile, Pibo checks for `SingletonLock`, `SingletonCookie`, and `SingletonSocket` in the template directory. If found, it raises `BROWSER_USE_AUTH_TEMPLATE_RUNNING` with a suggestion to close the template browser or pass another template.

#### Acceptance

- Copying a running template is rejected before removing or rewriting the target slot directory.
- The error names the template path and the detected lock file.
- Missing templates create an empty clean slot directory rather than using a live default browser profile.

#### Scenario: Template browser still open

- GIVEN the template directory contains `SingletonLock`
- WHEN an agent acquires a lease from that template
- THEN Pibo fails with a template-running error and leaves existing slot content untouched.

### Requirement: Lease warm-up is helpful but non-destructive

Lease acquisition SHOULD attempt to start the selected browser-use slot so Chrome and CDP state are ready, but warm-up failure MUST NOT invalidate the acquired lease.

#### Current

After writing the registry and printing the lease output, acquire runs the browser-use wrapper with `--pibo-ensure-chrome` and slot environment. Warm-up has a bounded timeout and prints a warning on failure for text output.

#### Acceptance

- Warm-up uses the acquired lease's session name, user-data dir, profile name, and browser-use home.
- Warm-up timeout kills only the warm-up child process.
- Warm-up failure reports a warning in text mode and keeps the lease active for manual use.
- `--no-warmup` is available to callers of the underlying acquire function and MUST skip browser start attempts when exposed.

#### Scenario: Chrome warm-up unavailable

- GIVEN the wrapper is missing or Chrome cannot start
- WHEN lease acquisition otherwise succeeds
- THEN the lease remains in the registry and the user sees a warning instead of losing the slot.

### Requirement: Listing and release reflect live lease state

The CLI MUST make lease ownership and lifecycle visible, and release MUST stop any matching browser-use process before marking the lease released.

#### Current

`lease list` auto-reaps stale leases, then prints rows with id, state, owner, session name, and user-data dir. JSON output includes `expired` and `processAlive`. `lease release <id>` kills the CDP pid for the lease session when present, marks the lease released, and optionally deletes the slot profile.

#### Acceptance

- Empty lists print a clear empty-state message.
- Text rows distinguish active, expired, and released leases.
- JSON rows include enough data for automation to decide whether a process is alive.
- Releasing an unknown id fails with `BROWSER_USE_AUTH_LEASE_NOT_FOUND` and suggests listing leases.
- `--delete-profile` removes only the released slot's user-data directory.

#### Scenario: Release and delete a slot

- GIVEN `pibo-chat-slot-001` is active
- WHEN an agent runs `pibo tools browser-use lease release pibo-chat-slot-001 --delete-profile`
- THEN Pibo terminates the slot's known browser process if present, marks the lease released, deletes that slot profile directory, and prints `Released pibo-chat-slot-001`.

### Requirement: Expired active leases can be reaped and reused

The system MUST turn expired active leases into released leases, terminating their known browser processes when possible.

#### Current

`lease reap-stale` and the auto-reap path in list/acquire scan active leases whose `expiresAt` is in the past. If the CDP pid is alive, Pibo sends `SIGTERM`; then it marks the lease released and updates the registry.

#### Acceptance

- Reap does not affect active non-expired leases.
- Reap does not fail when a pid file is missing or the process has already exited.
- Reaped leases become candidates for reuse by later acquire calls for the same app.
- The command reports how many leases were reaped.

#### Scenario: Expired lease is reused

- GIVEN an expired active lease exists for app `pibo-chat`
- WHEN an agent runs `lease reap-stale` and then acquires a lease for `pibo-chat`
- THEN Pibo may reuse the released slot id after refreshing its slot directory from the template.

## Edge Cases

- The lease registry file may be missing; Pibo MUST treat that as an empty versioned registry.
- The registry file may be malformed; commands that need it MUST fail rather than silently discarding state.
- App, owner, and profile labels can contain unsafe characters; slot ids MUST sanitize app names while retaining the display owner in the lease record.
- The template directory can be absent; Pibo MUST create a clean isolated slot rather than cloning any active default profile.
- CDP pid files can be stale or unreadable; process checks MUST degrade safely.
- A lease can expire while another command is listing or acquiring; the locked mutation path MUST be the authority for state transitions.

## Constraints

- **Security / Privacy:** Lease slots are local Chrome profiles that may contain authenticated cookies. Pibo MUST store them only under the browser-use tool home and MUST delete them only when the user explicitly releases with `--delete-profile` or a future policy says so.
- **Host Safety:** Lease commands MUST NOT start, stop, or reconfigure Pibo web gateways. They manage only browser-use profile state and matching browser-use processes.
- **Concurrency:** Registry writes MUST happen under the local lock directory.
- **Compatibility:** Shell export output is optimized for Unix-like agent environments; JSON output is the machine-readable alternative.
- **Context Economy:** Detailed browser-use operating instructions belong in tool guides, not in default profile context.

## Success Criteria

- [ ] SC-001: CLI tests prove progressive discovery for `pibo tools browser-use`, `auth-template`, and `lease`.
- [x] SC-002: Auth-template env tests prove a stable template directory and expected exported variables.
- [ ] SC-003: Acquire tests prove template files are copied, transient Chrome files are skipped, shell exports are printed, and JSON output includes export data.
- [ ] SC-004: Concurrency and max-slot tests prove the registry lock and pool exhaustion behavior.
- [ ] SC-005: Release and reap tests prove process-safe state transitions and optional profile deletion.
- [ ] SC-006: Error tests cover running templates, unknown lease ids, malformed registries, and lock timeout.

## Verification Coverage

This section separates behavior with direct tests from behavior that is currently source-inspected only. It is part of the lease contract so future test work can target the remaining unverified safety paths without duplicating broader Browser Automation or Curated CLI specs.

### Directly Tested

- `pibo tools browser-use` discovery lists the browser-use helper surface and points to environment setup, guides, targets, attach-chat, and lease acquisition. Verified by `test/tools-cli.test.mjs`.
- `pibo tools browser-use auth-template env` prints shell exports for the reusable authenticated template session and user-data directory. Verified by `test/tools-cli.test.mjs`.
- `pibo tools browser-use lease acquire` creates `pibo-chat-slot-001`, prints shell exports for the isolated session, copies ordinary template files such as `Cookies`, and omits `DevToolsActivePort`. Verified by `test/tools-cli.test.mjs`.
- `pibo tools browser-use lease list` reports the active lease id, owner, session name, and user-data directory. Verified by `test/tools-cli.test.mjs`.
- `pibo tools browser-use lease release <id> --delete-profile` prints the release confirmation and deletes the slot profile directory. Verified by `test/tools-cli.test.mjs`.

### Source-Inspected Only

- Nested discovery for bare `auth-template` and bare `lease` command groups is implemented in `src/tools/index.ts`, but current tests cover the main discovery output and concrete subcommands rather than each nested help branch.
- JSON output for acquire/list is implemented in `src/tools/browser-use-leases.ts` and wired in `src/tools/index.ts`, but current tests assert text output only.
- Registry locking, `--max-slots` exhaustion, reusable released/expired slots, and stale-lease reap behavior are implemented in `src/tools/browser-use-leases.ts`, but current tests do not simulate concurrent or expired registry states.
- Running-template rejection for `SingletonLock`, `SingletonCookie`, and `SingletonSocket`, malformed registry failures, unknown lease id errors, and lock timeout errors are source-inspected only.
- Warm-up behavior is source-inspected only; tests do not create a wrapper process or assert warning behavior on warm-up failure.

### Test Gaps

- Add CLI tests for `pibo tools browser-use auth-template` and `pibo tools browser-use lease` bare discovery output.
- Add JSON-mode tests for acquire and list to prove automation-safe export fields.
- Add unit or CLI tests for pool exhaustion, expired lease reuse, `reap-stale`, running-template rejection, malformed registries, and unknown lease release errors.
- Add a warm-up failure test that proves acquisition remains successful and the warning is reported in text mode.

## Assumptions and Open Questions

### Assumptions

- The default authenticated app remains `pibo-chat`.
- A local JSON registry is sufficient because browser-use leases are intended for local development and Docker worker workflows.
- Operators close the template browser after signing in before asking agents to acquire leases.

### Open Questions

- Should `--no-warmup` become a documented CLI option for `lease acquire`?
- Should leases record the source template hash to make stale template use visible?
- Should Pibo add an explicit garbage-collection policy for old released slot directories that were not deleted at release time?

## Traceability

| Requirement | Scenario / Story | Source Basis | Verification | Status |
|---|---|---|---|---|
| REQ-001 Browser-use auth commands are progressively discoverable | Agent discovers a safe auth workflow | `src/tools/index.ts`, `test/tools-cli.test.mjs` | Main discovery asserted; nested bare groups source-inspected | Partial |
| REQ-002 Auth template exports target a reusable closed Chrome profile | Prepare authenticated template | `src/tools/browser-use-leases.ts`, `src/tools/index.ts` | `test/tools-cli.test.mjs` | CLI-tested |
| REQ-003 Lease acquisition clones template state into isolated slots | Acquire isolated Chat Web slot | `src/tools/browser-use-leases.ts`, `test/tools-cli.test.mjs` | Text acquire path tested; JSON path source-inspected | Partial |
| REQ-004 Active lease counts and registry writes are concurrency-safe | Pool is full | `src/tools/browser-use-leases.ts` | Source inspection only | Source-inspected |
| REQ-005 Running template profiles are not cloned | Template browser still open | `src/tools/browser-use-leases.ts` | Source inspection only | Source-inspected |
| REQ-006 Lease warm-up is helpful but non-destructive | Chrome warm-up unavailable | `src/tools/browser-use-leases.ts` | Source inspection only | Source-inspected |
| REQ-007 Listing and release reflect live lease state | Release and delete a slot | `src/tools/browser-use-leases.ts`, `test/tools-cli.test.mjs` | List and release/delete tested; error/reap states source-inspected | Partial |
| REQ-008 Expired active leases can be reaped and reused | Expired lease is reused | `src/tools/browser-use-leases.ts` | Source inspection only | Source-inspected |

## Verification Basis

This spec was derived from current source code in `src/tools/browser-use-leases.ts`, `src/tools/index.ts`, `src/tools/browser-use-cdp.ts`, `src/tools/browser-use-wrapper.ts`, and current tests in `test/tools-cli.test.mjs`, `test/plugin-registry.test.mjs`, and `test/subagents.test.mjs`. Existing specs under `docs/specs/` were inspected to avoid duplicating the broader browser automation desktop, curated CLI tools, Docker worker, and web auth contracts.
