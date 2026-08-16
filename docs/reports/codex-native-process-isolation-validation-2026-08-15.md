# Codex Native Process and Isolation Validation

**Date:** 2026-08-15

**Task:** Multi-agent runtime adapter task 9.3

**Implementation commit:** `9a58ded0f6c17bc6a3ee48da9cfa4b63d835b882`

**Pull request:** #491

**Stacked on:** Codex stdio client PR #490 at `1a6633a6`

**Candidate package SHA-256:** `0baa5f44ccd73863e80e5c49caf92e22ba36bddeae9583e1f976873ff38f7a0b`

## Scope

Task 9.3 adds the process and configuration foundation needed by the future live Codex runtime session:

- validated operator configuration with an explicit executable, private state root, environment allowlist, and bounded lifecycle timeouts;
- safe availability diagnostics based on `codex --version`;
- enforcement of the supported `>=0.147.0 <0.148.0` range and exact `0.147.0` checkpoint reporting;
- a persistent private Codex home per configured runtime instance;
- an isolated process home, XDG directories, and temporary directory per Pibo Session generation;
- allowlisted environment inheritance plus scoped resource environment values;
- denial of environment variables that could replace runtime homes, executable search, loaders, or language startup hooks;
- official `codex app-server --stdio --strict-config` launch through the task-9.2 JSONL client with `experimentalApi: false`;
- verification that the App Server reports the expected private Codex home;
- bounded, idempotent process shutdown and generation cleanup.

This checkpoint does **not** register a Codex runtime instance or profile and does not create/resume threads or start model turns. Those remain tasks 9.4 and later.

## Isolation model

The implementation intentionally separates durable harness state from one live process generation:

1. Each configured runtime instance receives its own private persistent Codex home. Native authentication and thread state can later survive process and gateway restart without sharing state across configured instances.
2. Each live Pibo Session generation receives a different private process home, XDG state, and temporary directory. This state is removed when the process closes or startup fails.
3. Session-specific settings use official process-scoped environment and CLI configuration layers. Pibo does not point Codex at the invoking user's global home.
4. The persistent instance config is Pibo-owned, mode `0600`, contains no resolved credentials, and disables analytics by default. Runtime directories are mode `0700`.
5. Only explicitly allowlisted host environment variables are inherited. Adapter-resource values remain process-scoped, and protected environment keys cannot override the isolation boundary.

## Code and deterministic coverage

Primary code:

- `src/agent-runtimes/codex-native/config.ts`
- `src/agent-runtimes/codex-native/process.ts`
- `test/codex-native-process.test.mjs`
- `test/fixtures/codex-runtime-process-fake.mjs`

The deterministic fixture proves:

- exact, compatible, unsupported, missing, malformed, failed, oversized, and timed-out version probes;
- diagnostics do not include version-probe stderr secrets or executable paths;
- unknown config fields, relative state roots, duplicate environment keys, protected variables, and invalid timeouts fail closed;
- configured instances have different Codex homes;
- Pibo Session generations have different process homes and temporary state;
- scoped environment values do not cross sessions or inherit unrelated gateway values;
- one configured instance remains healthy when a sibling process is closed;
- App Server home mismatch rejects startup;
- failed startup removes generation state;
- successful shutdown is idempotent, terminates the owned process, removes only the generation, and preserves durable configured-instance state.

## Local verification

### Focused protocol/process suite

Command:

```text
node --test test/codex-native-protocol-checkpoint.test.mjs test/codex-native-client.test.mjs test/codex-native-process.test.mjs
```

Result:

- tests: 23
- pass: 23
- fail: 0
- duration: 1,245.450 ms

### Typecheck and build

The first unmodified `npm run typecheck` attempt reached the Chat UI TypeScript process's default V8 heap ceiling at approximately 640 MB and exited with code 134. It produced no TypeScript diagnostic and is not accepted as a validation result.

A combined yielded rerun with a 1.2-GB heap was later stopped by the host pressure guard when memory-full PSI average reached 12.86. It was also excluded from validation.

The authoritative sequential rerun used `NODE_OPTIONS=--max-old-space-size=1200` and passed:

- workflow typecheck;
- main workspace TypeScript typecheck;
- Chat UI typecheck;
- Context Files UI typecheck;
- VS Code extension/webview typecheck;
- full workspace build.

### Full suite

After the successful full build, the canonical isolated test runner passed:

- suites: 12
- tests: 1,683
- pass: 1,683
- fail: 0
- duration: 100,176.888 ms

`git diff --check` also passed before the implementation commit.

## Exact Pibo2 verification

The exact committed package was packed locally, checksum-verified on Pibo2, extracted without activating or restarting the gateway, and exercised against the pinned official binary.

Validated Codex binary:

- version: `codex-cli 0.147.0`
- binary SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`

Observed safe diagnostics:

- `codex_native_home_ready`
- `codex_native_available`
- reported version: `0.147.0`

Two exact App Server processes were started through different configured runtime instances. Verification established:

- both completed `initialize` / `initialized` with stable API only;
- both completed `model/list`, returning five models each;
- configured-instance Codex homes were different;
- Pibo Session process homes were different;
- instance root, Codex home, generation, and process-home modes were `0700`;
- instance config mode was `0600`;
- generated config contained no token, secret, password, or bearer material;
- closing the first process removed its generation while the second process continued serving `model/list`;
- both owned processes were gone after shutdown;
- temporary validation state was removed;
- the pre-existing global Codex-home state was unchanged;
- the development gateway remained active at the same main PID (`414306`);
- Codex App Server process count was `0` before and `0` after validation.

Measured Pibo2 timings:

| Operation | Time |
|---|---:|
| Availability/version diagnostics | 54 ms |
| First App Server startup and handshake | 210 ms |
| Second App Server startup and handshake | 195 ms |
| Parallel `model/list` requests | 1 ms |
| First process shutdown and generation cleanup | 12 ms |
| Second process shutdown and generation cleanup | 13 ms |

No authentication files or credential values were read, copied, printed, or included in the evidence.

## Result

Task 9.3 passes. The exact supported Codex binary is discoverable through bounded redacted diagnostics, configured instances receive private durable harness state, live Pibo Session generations receive isolated disposable process state, and process startup/shutdown cannot silently escape the configured home boundary.

The next implementation checkpoint is task 9.4: official thread start/resume/read/list/fork behavior, binding transitions, missing-thread handling, and adapter/session integration. No `codex-native` profile is registered by this checkpoint.
