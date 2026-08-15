# Runtime-Aware Agent Designer Validation — 2026-08-15

## Scope

This report validates the runtime-aware profile and Agent Designer milestone stacked on runtime binding PR #478. It covers custom-agent persistence, configured runtime discovery, availability diagnostics, capability-aware save validation, runtime-scoped model/auth catalogs, frozen-session context inspection, and Designer behavior. It does not claim native Codex execution; `codex-native` remains a future adapter/profile.

## Candidate

- Branch: `feature/agent-runtime-designer`
- Base: `2318a725` (`feature/agent-runtime-bindings`, PR #478)
- Commit: pending at the time of the local validation run
- Pi SDK protocol: `0.80.6`

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

Result: focused sets passed, including the 134-test Agent Designer/API/context set and 30-test generic routing/binding set.

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

Pending exact-candidate installation and authenticated API/browser validation. The planned checks are:

1. Upgrade the existing Pibo2 agent database and verify all existing custom agents read back as Pi with empty runtime options.
2. Verify `/api/chat/agent-catalog` reports the Pi runtime as available with diagnostics, model catalog, auth status, and capabilities.
3. Create and edit a Pi custom agent through the authenticated API and Designer UI.
4. Confirm an invalid Pi runtime-options save returns HTTP 400 and leaves persisted data unchanged.
5. Create a session, edit the profile default afterward, and verify the existing session's frozen binding remains Pi.
6. Verify Context Build displays runtime metadata and existing detailed Pi context without exposing secrets.
7. Capture an authenticated browser screenshot of the runtime selector, diagnostics, generated options area, and effective capability summary.

Model-turn parity is not part of this milestone and remains separately blocked by the previously reproduced external `openai-codex` provider-auth failure.
