# Agent Runtime Operations

**Updated:** 2026-08-16

This guide covers runtime selection, diagnostics, migration boundaries, private state, and safe troubleshooting for the built-in `pi` and `codex-native` runtimes. Architecture details live in [`architecture/agent-runtime-adapters.md`](./architecture/agent-runtime-adapters.md); exact integrated evidence and the remaining authentication gate are recorded in [`../reports/multi-agent-runtime-adapter-integrated-validation-2026-08-16.md`](../reports/multi-agent-runtime-adapter-integrated-validation-2026-08-16.md).

## Discover runtime support

Start with the profile and product surfaces rather than inspecting adapter files:

```text
pibo profile <profile>
pibo debug session <ps_...>
pibo debug trace <ps_...> --check
```

Agent Designer and authenticated `/api/chat/agent-catalog` expose configured runtime instances, availability, protocol/version diagnostics, model catalogs, option schemas, and effective capabilities. Disabled or degraded controls include an explanation; invalid selections are rejected when the agent is saved and again when a session starts.

Existing Pibo Sessions retain their frozen runtime binding when a profile default changes.

## Inspect a session

Use the Pibo Session id, never a native Pi or Codex id, for product routing:

```text
pibo debug session <ps_...>
pibo debug final <ps_...>
pibo debug trace <ps_...> --check
pibo debug messages <ps_...> list
pibo debug events <ps_...> --limit 20
pibo debug failures <ps_...>
```

The session summary reports:

- configured runtime instance and adapter;
- native session/thread id when present;
- `unbound`, `bound`, `missing`, or `error` state;
- protocol and version;
- binding revision;
- safe metadata keys without values.

Use `pibo debug trace <ps_...> --native-history --check` only when product history is insufficient and an adapter-native compatibility read is required.

## Binding states

- `unbound` — the Pibo Session exists, but the adapter has not durably created or attached its native state.
- `bound` — the native session/thread exists and is attached.
- `missing` — Pibo expected durable native state, but the adapter proved it is absent. Pibo keeps product history and does not create a replacement conversation.
- `error` — the binding cannot be used because of a persistent adapter or migration error.

Binding repair or rebind operations must use the authenticated product API and compare-and-set revision. Do not edit the table manually while the gateway is running.

## Pi runtime

`pi` is the default runtime. Its native id remains the Pi session id, and its resume state remains the Pi JSONL transcript. Compatibility fields and older APIs continue to expose `pi_session_id` during the migration window.

When a Pi session is reported missing:

1. confirm that the binding says native presence was expected;
2. inspect the Pi history provider through runtime-aware debug;
3. distinguish a legitimately disposable empty transcript from a transcript that previously contained turns;
4. repair through the supported binding action only after the missing state is understood.

Do not rename or rewrite legacy Pi transcripts to fit the runtime schema.

## Native Codex runtime

`codex-native` requires an official supported Codex App Server executable. The configured instance reports its validated version range and diagnostics. Pibo starts the App Server with a private Codex home and per-generation environment; it does not scrape terminal output.

Native Codex authentication must be established through a supported Pibo2-managed Codex login flow. Do not copy a developer's local OAuth files, Pi auth records, browser cookies, or ad hoc access tokens into the runtime home.

A fresh Codex `0.147.0` thread may remain live but not durable until its first native turn. After a durable thread exists, a missing rollout is reported as `missing` with a safe conflict response; it is never replaced through `thread/start`.

After interruption or a protocol/process failure, the adapter may recycle the App Server before the next turn. The Pibo Session and native thread binding remain unchanged when resume succeeds.

## Models, reasoning, and approvals

Model and reasoning choices are derived from the runtime's current model catalog. Use only the values advertised for the selected model. Adapter-specific profile options are validated separately from configured-instance operator settings.

Command and file approvals are stable Codex requests. Structured user input is experimental and is disabled unless the configured instance explicitly opts in. Pending requests are scoped to one thread and turn, redacted, bounded, and resolved at most once.

Selected Pibo MCP tools are pre-approved only on the generated credential-allowlisted Pibo server. External MCP servers retain their own native approval behavior. Truthful read-only MCP annotations may allow native policy to execute read-only tools without granting a blanket approval.

## Portable resources

Context Build is the authoritative inspection surface for one session generation. It reports each selected contribution's status, delivery mode, fidelity, and safe target:

- Pi tools compile directly; external harnesses use the session-scoped Pibo MCP bridge.
- Selected external MCP servers must connect and expose their filtered inventory before delivery is reported.
- Selected skills are copied into private roots; unselected skills must not appear.
- Selected context is ordered and delivered through adapter-supported channels without replacing the harness prompt.
- Pibo-managed subagents create child Pibo Sessions with independent bindings.

Generated resource roots live under `$PIBO_HOME/agent-runtimes/`. Directories use mode `0700`; generated files that may contain configuration references use mode `0600`. Cleanup removes generation directories and revokes credentials after router disposal, rebind, or terminal failure.

## Migration and rollback

The current product database schema is additive:

- schema v4 adds `session_runtime_bindings` and backfills existing Pi sessions;
- schema v5 adds runtime-neutral history compatibility metadata.

Before an operator-directed destructive rollback, back up `pibo.sqlite` and payload storage. A previous Pi-only binary can ignore additive runtime rows and continue Pi sessions, but it cannot execute native Codex sessions. Once non-Pi bindings exist, rollback must either retain a runtime-aware binary or explicitly accept that those sessions are unavailable. Never rewrite a Codex binding as Pi.

Useful read-only checks include:

- database `PRAGMA user_version`;
- one binding row per Pibo Session;
- no duplicate `(runtime_adapter_id, native_session_id)` pairs;
- matching Pi compatibility/native ids for Pi bindings;
- no orphan binding rows;
- SQLite integrity check.

## Service restart validation

After installing a candidate and restarting the development gateway:

1. verify the active executable and commit;
2. verify local and public Chat Web readiness;
3. reopen one durable Pi session and one durable Codex thread;
4. confirm unchanged Pibo/native ids and `bound` state;
5. complete one turn through each runtime;
6. run `pibo debug trace <ps_...> --check`;
7. inspect browser console/network and the relevant UI flow;
8. verify no leaked App Server or generation process remains after disposal.

## Failure triage

### Provider or protocol error

Inspect `pibo debug failures`, then send a bounded recovery turn only after status is idle. A provider error may be retryable or terminal for that turn without invalidating the binding.

### Stuck interruption

Confirm status and process state. The Codex adapter interrupts the active turn and then recycles the App Server so the provider connection cannot remain live. The next turn should resume the same thread.

### Missing Codex thread

Expect a safe conflict and a persisted `missing` binding. Absolute rollout paths, auth paths, or raw native errors must not reach the product response.

### Resource delivery failure

Use Context Build. A required failed or unsupported contribution blocks startup. Do not treat a generated file as proof that an MCP server, skill root, or context contribution loaded.

### TUI validation

Use the deterministic PTY scenario for a credential-free terminal smoke test:

```text
pibo debug pty scenario --builtin cli-session-ui-mocked-e2e --artifact
```

The scenario follows the current room picker, creates a session, sends a mocked turn, inspects `/status`, and exits without invoking a provider.

## Security rules

- Do not print or copy auth files, cookies, machine keys, bearer tokens, environment secrets, device codes, or private locator/config values.
- Do not mutate global Codex or Pi configuration merely to run one Pibo Session.
- Do not broaden generated Pibo MCP credentials beyond the selected generation and tool allowlist.
- Do not pre-approve external MCP servers globally.
- Do not infer a capability from an upstream schema alone; require end-to-end evidence.
