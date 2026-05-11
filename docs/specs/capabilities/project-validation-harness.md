# Spec: Project Validation Harness

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage  
**Related docs:** `docs/specs/capabilities/package-build-and-distribution.md`, `docs/specs/capabilities/operator-cli-discovery-and-dispatch.md`, `docs/specs/capabilities/local-store-ownership-and-canonical-data-boundaries.md`

## Why

Pibo's current test suite is more than a collection of unit tests. It is the executable contract that guards the compiled package boundary, local-store isolation, CLI discovery behavior, gateway safety, and migration away from legacy Chat Web stores.

The harness needs its own behavior spec because regressions here can make source-backed specs untrustworthy. A test that imports source directly, writes into a real Pibo home, or touches host gateways can pass locally while failing to validate the installable product.

## Goal

Pibo's validation harness MUST test the built package artifact with isolated local state, deterministic command execution, and source-guard checks that protect current product boundaries.

## Background / Current State

`package.json` defines `npm test` as `npm run build && node --test test/*.test.mjs`. The tests import modules from `../dist/...`, not `src/...`, so they validate compiled output. Many tests create temporary directories through `node:os.tmpdir()` and set scoped environment variables such as `PIBO_HOME` or `MCP_CONFIG_PATH` only for the tested process.

CLI-oriented tests execute `node dist/bin/pibo.js ...` through `execFile`. Store tests use temporary SQLite files or in-memory databases. Source-guard tests read project source files directly when the desired behavior is absence of legacy wiring, forbidden flags, or unsafe restart mechanisms.

## Scope

### In Scope

- Root validation scripts in `package.json`.
- Node test files under `test/*.test.mjs`.
- Tests that execute the compiled CLI entrypoint.
- Tests that import compiled modules from `dist/`.
- Temporary store and environment isolation used by tests.
- Source-guard tests that assert forbidden code paths stay absent.

### Out of Scope

- Browser end-to-end automation against a live Chat Web instance.
- Docker compute worker lifecycle and gateway browser checks.
- Production or dev gateway restarts during validation.
- Publishing, release approval, or deployment workflows.
- Detailed behavior of each product subsystem, which remains owned by its capability spec.

## Requirements

### Requirement: Test runs validate the compiled artifact

The project test command MUST build the package before running tests, and tests SHOULD import product modules from `dist/` instead of `src/`.

#### Current

`npm test` runs `npm run build && node --test test/*.test.mjs`. Test files import runtime modules from paths such as `../dist/core/runtime.js`, `../dist/gateway/server.js`, and `../dist/apps/chat/web-app.js`.

#### Target

A passing test run proves that the compiled package output can satisfy the tested product contracts, not merely that TypeScript source can be loaded by a development runner.

#### Acceptance

- `package.json` keeps `npm test` ordered so `npm run build` completes before `node --test` starts.
- Product behavior tests import compiled JavaScript from `dist/` unless the test is explicitly a source-guard check.
- A clean checkout with dependencies installed can run `npm test` without requiring ad hoc TypeScript loaders.

#### Scenario: Clean validation executes compiled code

- GIVEN dependencies are installed and `dist/` may be stale or missing
- WHEN an operator runs `npm test`
- THEN the package is built first
- AND Node's built-in test runner executes `test/*.test.mjs`
- AND product imports resolve from the rebuilt `dist/` tree.

### Requirement: Local state is isolated per test

Tests that persist data MUST use temporary directories, in-memory databases, or explicitly scoped environment overrides instead of the operator's real Pibo home or workspace state.

#### Current

Store, auth, MCP, package, prompt, and Chat Web tests create paths with `mkdtemp` or `mkdtempSync` under `tmpdir()`. Tests that need `PIBO_HOME`, `PI_CODING_AGENT_DIR`, or `MCP_CONFIG_PATH` set and restore those variables around the tested behavior.

#### Target

Validation runs do not read, modify, or depend on live user sessions, credentials, gateway stores, package registries, or workspace settings.

#### Acceptance

- Tests that create SQLite stores use `:memory:` or temporary file paths.
- Tests that mutate Pibo-owned stores set a temporary root or storage directory.
- Tests that override process environment restore the previous value after the assertion path completes.
- Tests do not require a pre-existing `.pibo/` directory in the repository or user home.

#### Scenario: Store test cannot corrupt live state

- GIVEN a developer has real Pibo sessions under their normal Pibo home
- WHEN the Node test suite runs
- THEN tests create their own temporary stores
- AND no test writes to the developer's live session, auth, reliability, or Chat Web databases.

### Requirement: CLI tests execute bounded commands through the compiled entrypoint

CLI validation tests MUST execute the compiled `pibo` entrypoint with explicit arguments and bounded child-process calls.

#### Current

CLI tests use `execFile` or `spawnSync` with `node dist/bin/pibo.js` and specific arguments such as `debug --help`, `data inventory --json`, `tools list`, and gateway lifecycle helper checks.

#### Target

CLI tests validate user-visible command behavior without depending on shell parsing, global installs, or host gateway state.

#### Acceptance

- CLI tests call `node dist/bin/pibo.js` or a directly inspected script path instead of assuming a globally installed `pibo` binary.
- Test commands pass arguments as arrays, not interpolated shell strings.
- Commands that need local stores or config receive temporary roots through arguments, environment, or working directory.
- Tests do not start, stop, or restart host production or dev gateways.

#### Scenario: CLI discovery is checked without a global install

- GIVEN the project has been built
- WHEN a CLI test invokes `node dist/bin/pibo.js --help`
- THEN it receives the compiled CLI discovery output
- AND the test does not depend on `npm link`, a global binary, or shell aliases.

### Requirement: Source guards protect forbidden wiring and migrations

Tests MAY inspect source files directly when the contract is that a forbidden string, import, feature flag, or unsafe mechanism remains absent.

#### Current

`chat-data-v2-legacy-guard.test.mjs` checks that Chat Web no longer imports legacy event-log, read-model, and room modules, and that removed data-mode flags are absent. Gateway restart safety tests inspect deployment scripts for the expected Pibo CLI restart commands and the absence of unsafe direct restart mechanisms.

#### Target

Source guards make architectural removals and safety constraints testable even when the forbidden behavior has no runtime API to call.

#### Acceptance

- Source guards name the files they inspect and assert concrete forbidden or required strings.
- Source guards stay narrow to product-boundary invariants, not general style preferences.
- A failing source guard clearly identifies the reintroduced legacy path, removed flag, or unsafe command.

#### Scenario: Legacy Chat Web store import is reintroduced

- GIVEN a source change imports the old Chat Web read model from the active web app
- WHEN the source-guard test runs
- THEN the test fails before release validation succeeds
- AND the failure points to the forbidden legacy wiring.

### Requirement: Validation avoids external services unless explicitly stubbed or isolated

Tests MUST NOT require live network services, real provider credentials, host gateways, or Docker workers. Network and provider behavior MUST be simulated, loopback-only, or guarded behind temporary local servers.

#### Current

HTTP behavior tests use local Node HTTP servers or direct request/response helpers. Login-action tests stub the provider exchange path and isolate credential state through a temporary `PI_CODING_AGENT_DIR`. Gateway protocol tests use local server/client primitives inside the test process.

#### Target

The default Node test suite is safe to run in development, CI, and scheduled validation without spending credentials, contacting real providers, or mutating long-running host services.

#### Acceptance

- Tests for provider login or usage do not require real OAuth credentials.
- Tests that need network behavior use loopback servers created by the test process.
- Tests do not call `pibo compute spawn` or Docker commands.
- Tests do not restart managed gateways.

#### Scenario: Provider login behavior is validated offline

- GIVEN no OpenAI or external provider credential is configured
- WHEN login-action tests run
- THEN they validate request construction, state handling, and credential persistence through stubs or temporary state
- AND no real provider login is attempted.

## Edge Cases

- A test that imports `src/` can pass despite missing compiled exports; this weakens package validation and should be limited to source guards.
- A test that forgets to restore an environment variable can change later tests in the same process.
- A test that shells through a string can behave differently across shells or accidentally execute unrelated commands.
- A test that writes to the default Pibo home can corrupt active sessions or make results depend on previous local state.
- A source guard that checks broad formatting can become noisy; guards should target durable architectural constraints.

## Constraints

- **Compatibility:** The harness uses Node's built-in `node:test` runner and the package's Node 24+ runtime floor.
- **Security / Privacy:** Tests MUST NOT read or write real credentials, live session stores, or personal Chat Web data.
- **Performance:** The default suite may build the web UIs because it validates the package artifact, but individual focused tests SHOULD remain narrow and deterministic.
- **Dependencies:** Tests depend on the built `dist/` tree, local npm dependencies, and Node built-ins such as `node:sqlite`, `node:test`, and `node:child_process`.

## Success Criteria

- [ ] SC-001: `npm test` builds first and then runs all `test/*.test.mjs` files through Node's test runner.
- [ ] SC-002: Product behavior tests import compiled modules from `dist/`.
- [ ] SC-003: Tests that persist state use temporary paths or in-memory databases.
- [ ] SC-004: CLI tests execute compiled entrypoints with argument arrays and scoped environment.
- [ ] SC-005: Source guards cover only explicit product-boundary removals or safety constraints.
- [ ] SC-006: The default test suite does not require Docker, real provider credentials, or host gateway restarts.

## Assumptions and Open Questions

### Assumptions

- The scheduled source-specs job treats current test files as part of the current project source of truth.
- Browser end-to-end checks remain separate from `npm test` unless future scripts make them part of default validation.
- Source guards are acceptable when they protect explicit architectural constraints that cannot be observed through a public API.

### Open Questions

- Should focused package validation add a separate installed-package smoke test after `npm pack --dry-run`?
- Should long-running or browser-dependent checks get their own named script so `npm test` stays deterministic?
- Should every capability spec list the exact current test files that cover each requirement?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Test runs validate the compiled artifact | Clean validation executes compiled code | `package.json`, `test/*.test.mjs` imports | Draft |
| REQ-002 Local state is isolated per test | Store test cannot corrupt live state | Temp-dir and environment setup in `test/*.test.mjs` | Draft |
| REQ-003 CLI tests execute bounded commands through the compiled entrypoint | CLI discovery is checked without a global install | CLI-oriented tests using `execFile` / `spawnSync` | Draft |
| REQ-004 Source guards protect forbidden wiring and migrations | Legacy Chat Web store import is reintroduced | `test/chat-data-v2-legacy-guard.test.mjs`, gateway restart safety checks | Draft |
| REQ-005 Validation avoids external services unless explicitly stubbed or isolated | Provider login behavior is validated offline | Login, HTTP, gateway, and web-channel tests | Draft |

## Verification Basis

This spec is based on current workspace code and project files:

- `package.json`
- `test/*.test.mjs`
- `src/bin/pibo.ts`
- `scripts/deploy-web.sh`
- `scripts/deploy-web-dev.sh`
- `docs/specs/capabilities/package-build-and-distribution.md`
