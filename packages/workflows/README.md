# Pibo Workflows

Initial package boundary for the Pibo Workflow System V1 framework.

The package is organized around the PRD-required internal submodules:

- `src/api` — public authoring helpers, builder API, object definition normalization
- `src/registry` — workflow registry and implementation lookup
- `src/types` — workflow IR, runtime, store, diagnostics, events, and utility types
- `src/validation` — definition, schema, graph, registry, capability, state, and loop validation
- `src/graph` — graph store, traversal, indices, cycle/toposort validation, and serialization
- `src/compiler` — validated definitions to execution plans and projection metadata
- `src/runtime` — durable kernel, scheduling, attempts, retries, waits, leases, commands, and cancellation
- `src/store` — `pibo-workflows.sqlite` schema/store and persistence API
- `src/xstate` — XState projection, snapshots, and inspection helpers
- `src/fixtures` — workflow fixtures for tests and manual validation
- `src/testing` — test harnesses, fake providers, and restart helpers

The V1 JSON port schema subset is documented in `../../docs/specs/changes/pibo-workflow-system-v1/structured-outputs-json-schema-subset.md` and implemented by `src/validation`.
