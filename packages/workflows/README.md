# Pibo Workflows

Initial package boundary for the Pibo Workflow System V1 framework.

The package is organized around the PRD-required internal submodules:

- `src/api` — public authoring helpers, builder API, object definition normalization
- `src/registry` — workflow registry and implementation lookup
- `src/types` — workflow IR, runtime, store, diagnostics, events, and utility types
- `src/validation` — definition, schema, graph, registry, capability, state, and loop validation
- `src/graph` — reserved for Pibo-owned graph indices and reusable traversal primitives
- `src/compiler` — reserved for validated definitions, execution plans, and projection metadata
- `src/runtime` — Pibo-owned deterministic scheduling, attempts, retries, waits, commands, events, and persistence
- `src/store` — `pibo-workflows.sqlite` schema/store and persistence API
- `src/xstate` — XState projection, snapshots, and inspection helpers
- `src/fixtures` — workflow fixtures for tests and manual validation
- `src/testing` — test harnesses, fake providers, and restart helpers

The workflow IR and persisted Pibo runtime facts are the execution contract and source of truth. External graph frameworks may serve as design references, but the package does not delegate scheduling or persistence to them.

The V1 JSON port schema subset is documented in `../../docs/specs/changes/pibo-workflow-system-v1/structured-outputs-json-schema-subset.md` and implemented by `src/validation`.
