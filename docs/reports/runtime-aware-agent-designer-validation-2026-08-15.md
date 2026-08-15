# Runtime-Aware Agent Designer Validation — 2026-08-15

## Scope

This report validates the runtime-aware profile and Agent Designer milestone stacked on runtime binding PR #478. It covers custom-agent persistence, configured runtime discovery, availability diagnostics, capability-aware save validation, runtime-scoped model/auth catalogs, frozen-session context inspection, and Designer behavior. It does not claim native Codex execution; `codex-native` remains a future adapter/profile.

## Candidate

- Branch: `feature/agent-runtime-designer`
- Base: `2318a725` (`feature/agent-runtime-bindings`, PR #478)
- Commit: `d1e8e4d38fab16988c6117fdbf3ab7a6100577d2`
- Package: `@pasko70/pibo` `1.7.2`
- Active Pibo2 candidate: `agent-runtime-designer/d1e8e4d38fab16988c6117fdbf3ab7a6100577d2`
- Pi SDK protocol: `0.80.6`
- Authenticated validation window: 2026-08-15 07:31–07:34 UTC

## Implemented behavior

- Existing custom agents migrate to `runtime_instance_id = 'pi'` and `runtime_options_json = '{}'`.
- New and edited custom agents persist configured runtime instance ids and adapter profile options.
- Runtime ids and JSON options are normalized before persistence.
- Candidate profiles are validated before create/update writes; unknown, disabled, unavailable, capability-incompatible, and adapter-invalid selections return HTTP 400.
- Session startup repeats portable-capability and adapter validation.
- Runtime catalog entries include descriptor metadata, enabled/available state, diagnostics, config schema, declared capabilities, runtime-scoped models, and auth status.
- Agent Designer shows every configured runtime, keeps disabled/unavailable instances visible, renders schema-generated primitive options plus an advanced JSON editor, and blocks malformed JSON from autosave/navigation.
- Unsupported Pibo tools, skills, context, MCP, subagents, run/goal packages, Pi packages, Pi built-in overrides, model catalogs, and reasoning controls remain visible with explanations. Persisted stale selections can still be removed.
- Runtime-specific model/auth catalogs drive the selected runtime's model controls. The legacy top-level Pi model catalog remains additive for compatibility.
- Context Build reads the session's frozen runtime binding. Non-Pi sessions receive a runtime-neutral contribution snapshot and do not render Pi startup prompt content. Runtime option values are not exposed in that snapshot.
- Custom Pi-backed runtime instance ids such as `codex` remain valid when explicitly registered, while no built-in `codex` profile alias is introduced.

## Local verification

### Typecheck

Command:

```text
npm run typecheck
```

Result: passed.

### Focused verification

Covered:

- custom-agent old-table migration and runtime defaults;
- runtime selection/options persistence and reopen;
- custom-agent profile runtime propagation;
- runtime diagnostics, model/auth catalog inspection, and profile validation;
- missing `listModels()` contract detection;
- unsupported portable capability rejection at save and session startup;
- frozen runtime selection after profile-default change;
- Pi-backed custom `codex` instance compatibility without a built-in profile alias;
- schema/JSON Designer state and autosave guards;
- authenticated-style Chat API create/update rejection paths;
- frozen non-Pi Context Build without Pi startup prompt rendering;
- unchanged Pi context-build and model-catalog behavior.

Result: focused sets passed, including the 134-test Agent Designer/API/context set and 30-test generic routing/binding set. After Pibo2 evidence capture, `npm run typecheck` and the six directly changed Agent Designer/runtime/API test files were rerun with **131/131 passing**.

### Full suite

Command:

```text
npm test
```

Result: **1,632 passed, 0 failed** across 12 suites.

## Compatibility findings

- Existing Pi custom-agent rows require no manual migration.
- Existing session bindings remain authoritative after profile runtime edits.
- Plugin profiles remain read-only in Designer.
- Existing `codex` compatibility semantics are unchanged: there is still no built-in `codex` profile alias, and an explicitly configured Pi runtime instance named `codex` remains Pi-backed.
- The normal Pi context inspector and legacy model catalog remain available.

## Pibo2 validation

### Exact deployment and health

The checksum-installed candidate was active from:

```text
/opt/pibo-candidates/agent-runtime-designer/d1e8e4d38fab16988c6117fdbf3ab7a6100577d2
```

The candidate executable reported version `1.7.2`. Local `/health` returned `{"status":"ok","mode":"main"}`, and the public Chat URL returned HTTP 200.

### Existing-data migration

The existing `/root/.pibo/chat-agents.sqlite` schema contained `runtime_instance_id` and `runtime_options_json`. After candidate startup and again after fixture cleanup:

- total existing custom agents: 5;
- agents with `runtime_instance_id = 'pi'`: 5;
- agents with `runtime_options_json = '{}'`: 5;
- remaining `runtime-designer-proof-*` fixtures: 0.

No manual data rewrite was required.

### Authenticated API round trip

The authenticated headful browser exercised the same-origin Chat API against the public Pibo2 URL:

- `GET /api/chat/agent-catalog`: HTTP 200;
- valid custom-agent create: HTTP 201;
- custom-agent edit: HTTP 200;
- copied custom-agent create: HTTP 201;
- invalid Pi runtime-options update: HTTP 400;
- new session from the custom profile: HTTP 201;
- runtime-binding reads before and after a later profile edit: HTTP 200;
- `GET /api/chat/context-build`: HTTP 200.

The live Pi runtime catalog reported:

- enabled and available, embedded transport;
- protocol `pi-sdk` with supported range `0.80.6`;
- diagnostic `pi_runtime_available`;
- 1,060 models;
- configured auth status for `openai-codex`, `glm`, `minimax`, and `openai`;
- Pibo tools `direct`, external MCP `native`, skills `native`, context `native`, model catalog enabled, reasoning enabled, and history enabled.

The temporary original and copied profiles both round-tripped `runtimeInstanceId: "pi"` and `runtimeOptions: {}`. Updating the original with `{ "unsupportedPiOption": true }` returned HTTP 400 with `The Pi runtime does not accept adapter-specific profile options.` A following authenticated read still returned `{}` for persisted runtime options.

### Frozen binding

A temporary session was created from the validated custom profile. Before and after editing that profile's description, the persisted binding projection remained byte-for-byte equivalent:

```text
runtimeInstanceId: pi
adapterId: pi
nativeSessionId: 49cf84ad-8fc4-428d-b0e5-58c98d4cd9c5
state: unbound
revision: 1
protocol: pi-sdk
```

Pibo2 had only the configured `pi` runtime instance during this milestone, so the live edit did not switch the profile to another runtime. The stronger profile-default-change scenario is covered by the deterministic router test that changes the profile runtime after session creation and verifies the existing binding remains frozen.

### Context Build and browser rendering

Context Build resolved the temporary session through its frozen `pi/pi` binding and reported:

- runtime available, embedded, protocol `pi-sdk`, binding `unbound`;
- 6 top-level nodes and 36 total nodes;
- approximately 3,060 tokens;
- 0 warnings and 0 errors;
- active prompt/runtime shell, tool surface, context files, and diagnostics sections;
- disabled empty skills and runtime-extension sections.

Authenticated Chrome rendered the runtime selector, availability state, advanced JSON options, Pi diagnostic, capability summary, runtime-scoped model controls, and Context Build metadata. Chrome DevTools reported no console messages after the Context Build render.

Evidence:

- `docs/reports/runtime-aware-agent-designer-pibo2-2026-08-15.png`
- `docs/reports/runtime-aware-context-build-pibo2-2026-08-15.png`

Both screenshots target the content panels and exclude the account header.

### Cleanup

The validation session was archived and permanently deleted, both temporary agents were archived and permanently deleted, an authenticated session-binding probe returned HTTP 404 afterward, and the database returned to the five pre-existing custom-agent rows described above.

Model-turn parity is not part of this milestone and remains separately blocked by the previously reproduced external `openai-codex` provider-auth failure.
