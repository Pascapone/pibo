---
type: "Specification"
title: "Pibo Sessions and Runtime Binding Persistence"
description: "Defines the implemented pibo sessions and runtime binding persistence contract and its current ownership boundaries."
tags: ["data", "sessions"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T19:25:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "d30e0250fdce4017920c7f9c41c1e2067124d23b"
  requirements:
    - id: "WP02-DATA-SES-001"
      status: "implemented"
      sources:
        - path: "src/sessions/store.ts"
          symbol: "PiboSession"
        - path: "src/sessions/store.ts"
          symbol: "createPiboSessionId"
        - path: "src/sessions/store.ts"
          symbol: "createPiSessionId"
        - path: "src/sessions/store.ts"
          symbol: "createPiboSession"
      tests:
        - path: "test/session-store.test.mjs"
          name: "pibo session builder creates opaque product and Pi identities"
        - path: "test/session-store.test.mjs"
          name: "in-memory pibo session store creates, updates, and finds sessions"
      failures:
        - "createAgentRuntimeBindingPersistence accepts only exact audited built-in store methods and rejects custom or overridden persistence capabilities."
        - "Adapter/native locator uniqueness prevents duplicate native binding ownership."
      confidence: "high"
    - id: "WP02-DATA-SES-002"
      status: "implemented"
      sources:
        - path: "src/sessions/store.ts"
          symbol: "PiboSession"
        - path: "src/sessions/store.ts"
          symbol: "CreatePiboSessionInput"
        - path: "src/sessions/store.ts"
          symbol: "UpdatePiboSessionInput"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "PiboDataSessionStore"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "create"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "update"
      tests:
        - path: "test/pibo-data-session-store.test.mjs"
          name: "pibo data session store persists structured session fields"
        - path: "test/session-store.test.mjs"
          name: "sqlite pibo session store persists structured session fields"
      failures:
        - "createAgentRuntimeBindingPersistence accepts only exact audited built-in store methods and rejects custom or overridden persistence capabilities."
        - "Adapter/native locator uniqueness prevents duplicate native binding ownership."
      confidence: "high"
    - id: "WP02-DATA-SES-003"
      status: "implemented"
      sources:
        - path: "src/sessions/runtime-binding.ts"
          symbol: "RuntimeSessionBinding"
        - path: "src/sessions/runtime-binding.ts"
          symbol: "createInitialRuntimeSessionBinding"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "PiboDataSessionStore"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "getRuntimeBinding"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "updateRuntimeBinding"
      tests:
        - path: "test/runtime-session-binding.test.mjs"
          name: "session creation freezes an unbound runtime selection and keeps Pi compatibility additive"
        - path: "test/session-router-store.test.mjs"
          name: "session router keeps the persisted runtime instance when the profile default changes"
      failures:
        - "createAgentRuntimeBindingPersistence accepts only exact audited built-in store methods and rejects custom or overridden persistence capabilities."
        - "Adapter/native locator uniqueness prevents duplicate native binding ownership."
      confidence: "high"
    - id: "WP02-DATA-SES-004"
      status: "implemented"
      sources:
        - path: "src/sessions/runtime-binding.ts"
          symbol: "nextRuntimeSessionBinding"
        - path: "src/sessions/runtime-binding.ts"
          symbol: "assertRuntimeSessionBindingTransition"
        - path: "src/sessions/runtime-binding.ts"
          symbol: "RuntimeSessionBindingConflictError"
        - path: "src/sessions/runtime-binding.ts"
          symbol: "RuntimeSessionBindingTransitionError"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "resolvePiboDataRuntimeBindingCas"
        - path: "src/sessions/sqlite-store.ts"
          symbol: "resolveSqliteRuntimeBindingCas"
      tests:
        - path: "test/runtime-session-binding.test.mjs"
          name: "session creation freezes an unbound runtime selection and keeps Pi compatibility additive"
      failures:
        - "createAgentRuntimeBindingPersistence accepts only exact audited built-in store methods and rejects custom or overridden persistence capabilities."
        - "Adapter/native locator uniqueness prevents duplicate native binding ownership."
      confidence: "medium"
    - id: "WP02-DATA-SES-005"
      status: "implemented"
      sources:
        - path: "src/sessions/runtime-binding-persistence.ts"
          symbol: "createAgentRuntimeBindingPersistence"
        - path: "src/sessions/runtime-binding-persistence.ts"
          symbol: "isAgentRuntimeBindingPersistence"
        - path: "src/sessions/sqlite-store.ts"
          symbol: "SqlitePiboSessionStore"
      tests:
        - path: "test/runtime-session-binding.test.mjs"
          name: "legacy sqlite migration backfills bound Pi rows and makes the compatibility Pi column nullable"
        - path: "test/data-v2-store.test.mjs"
          name: "v2 schema backfills legacy Pi bindings and keeps old-writer Pi updates synchronized"
      failures:
        - "createAgentRuntimeBindingPersistence accepts only exact audited built-in store methods and rejects custom or overridden persistence capabilities."
        - "Adapter/native locator uniqueness prevents duplicate native binding ownership."
      confidence: "high"
    - id: "WP02-DATA-SES-006"
      status: "implemented"
      sources:
        - path: "src/sessions/store.ts"
          symbol: "PiboSessionStore"
        - path: "src/sessions/store.ts"
          symbol: "PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "PiboDataSessionStore.advanceAgentObservationAutoCursor"
      tests:
        - path: "test/pibo-data-session-store.test.mjs"
          name: "pibo data session store persists monotonic agent observation auto cursors"
        - path: "test/subagent-observation-restart.test.mjs"
          name: "delegated observation auto cursors persist across router restart"
      failures:
        - "Automatic observation cursor scopes are bounded to the most recent 128 per parent session."
      confidence: "high"
---

# Scope

Pibo Session records, ps_ identity creation, parent/origin fields, active model metadata, runtime binding state, revisioned CAS, bounded delegated-observation consumer cursors, and compatibility session stores.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: PiboSession; PiboSessionStore; RuntimeSessionBinding; states unbound/bound/missing/error; sessions, session_runtime_bindings, and session_agent_observation_auto_cursors in pibo.sqlite; compatibility pibo_sessions and pibo_session_runtime_bindings. Delegated-observation cursors advance monotonically per parent and normalized query scope, survive durable-store restart, cascade with parent deletion, and retain at most 128 scopes per parent.
- Routes and protocols: No HTTP or wire protocol is owned.
- State transitions: Creation produces opaque ps_ identity and an initial binding. bound and missing states require a native session ID. Binding updates compare expected revision and increment revision; stale revisions throw RuntimeSessionBindingConflictError. Soft-deleted sessions are excluded from normal get/list/find.
- Failure and security: createAgentRuntimeBindingPersistence accepts only exact audited built-in store methods and rejects custom or overridden persistence capabilities. Adapter/native locator uniqueness prevents duplicate native binding ownership.
- Compatibility: Pi identity is additive compatibility metadata, not the product identity. Legacy SQLite rows backfill bound Pi mappings and permit nullable compatibility Pi columns. Existing sessions retain their active model/runtime selection when defaults change.

# Requirements and invariants

## Requirement: WP02-DATA-SES-001

Session creation and lookup SHALL use opaque ps_ Pibo Session IDs; Pi/native IDs remain compatibility or binding fields.

## Requirement: WP02-DATA-SES-002

parentId SHALL represent hierarchy and originId derivation; structured fields SHALL survive persistence.

## Requirement: WP02-DATA-SES-003

Active model metadata and runtime binding locator/state SHALL persist separately and remain frozen for existing sessions unless explicitly updated.

## Requirement: WP02-DATA-SES-004

Runtime binding transitions SHALL enforce valid state/native-ID combinations and revisioned compare-and-set without overwriting a newer revision.

## Requirement: WP02-DATA-SES-005

First-use binding persistence SHALL be exposed only for audited built-in stores; legacy Pi mappings SHALL migrate without becoming product identity.

## Requirement: WP02-DATA-SES-006

Delegated-observation automatic cursors SHALL advance monotonically per parent and normalized query scope, survive durable store restart, cascade with parent deletion, and remain bounded to the 128 most recently advanced scopes per parent.

# Interfaces and ownership

Capability IDs: `pibo.data.sessions`.

Implemented public contracts:

- `PiboSession`
- `createPiboSessionId`
- `createPiSessionId`
- `createPiboSession`
- `CreatePiboSessionInput`
- `UpdatePiboSessionInput`
- `PiboDataSessionStore.create`
- `PiboDataSessionStore.update`
- `RuntimeSessionBinding`
- `createInitialRuntimeSessionBinding`
- `PiboDataSessionStore.getRuntimeBinding`
- `PiboDataSessionStore.updateRuntimeBinding`
- `nextRuntimeSessionBinding`
- `assertRuntimeSessionBindingTransition`
- `RuntimeSessionBindingConflictError`
- `RuntimeSessionBindingTransitionError`
- `resolvePiboDataRuntimeBindingCas`
- `resolveSqliteRuntimeBindingCas`
- `createAgentRuntimeBindingPersistence`
- `isAgentRuntimeBindingPersistence`
- `SqlitePiboSessionStore`
- `PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES`
- `PiboSessionStore.getAgentObservationAutoCursor`
- `PiboSessionStore.advanceAgentObservationAutoCursor`
- `PiboDataSessionStore.getAgentObservationAutoCursor`
- `PiboDataSessionStore.advanceAgentObservationAutoCursor`

Related ownership boundaries:

- SPC-PROD-003 defines product hierarchy semantics consumed here.
- SPC-RUN-002 owns runtime adapter behavior and native session creation.
- SPC-DATA-001 owns other pibo.sqlite facts.
- SPC-DATA-003 owns interrupted telemetry settlement invoked by PiboDataSessionStore recovery.

# Failure and security behavior

- createAgentRuntimeBindingPersistence accepts only exact audited built-in store methods and rejects custom or overridden persistence capabilities.
- Adapter/native locator uniqueness prevents duplicate native binding ownership.

# Known limits

- Non-current claim excluded: use Pi session ID as a synonym for Pibo Session ID.
- Non-current claim excluded: present SqlitePiboSessionStore compatibility tables as the canonical product store.
- Non-current claim excluded: imply model defaults mutate existing sessions.
- Current limit or evidence gap: The inspected tests do not name a dedicated stale-revision CAS conflict scenario, although transition and store paths implement it.
- Automatic observation cursor persistence is optional on compatibility stores; the router supplies an in-memory fallback when a store does not implement it.

# Verification and traceability

Source symbols and named tests are bound to commit `d30e0250fdce4017920c7f9c41c1e2067124d23b`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/session-store.test.mjs test/pibo-data-session-store.test.mjs test/runtime-session-binding.test.mjs test/session-router-store.test.mjs test/data-v2-store.test.mjs`

# Related concepts

- SPC-PROD-003 defines product hierarchy semantics consumed here.
- SPC-RUN-002 owns runtime adapter behavior and native session creation.
- SPC-DATA-001 owns other pibo.sqlite facts.
- SPC-DATA-003 owns interrupted telemetry settlement invoked by PiboDataSessionStore recovery.
