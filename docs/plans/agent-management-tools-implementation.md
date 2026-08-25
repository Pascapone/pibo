# Agent Management Tools Implementation Plan

**Status:** Done
**Date:** 2026-08-23
**Updated:** 2026-08-25
**Spec:** [Agent Delegation and Management](../specs/capabilities/subagent-delegation.md)
**Design:** [Agent Management Tool and CLI Design](./agent-management-tool-design.md)

## Success Boundary

Implementation is complete only when the shared tools, filtering, run compatibility, existing trace UI, debug CLI, real Pibo2 provider path, and headful UI path are all verified.

## Tasks

### 1. Replace the tool contract

- Replace per-subagent name generation and definitions with one `PiboAgentsController` and four definitions.
- Add dynamic catalog rendering and schemas.
- Assemble all four tools when any delegated agent is available.
- Keep all four in the run-control yieldable set.

**Verify:** focused tool-definition tests assert four stable names, schemas, catalog text, execution delegation, and absence of `pibo_subagent_*`.

### 2. Implement router lifecycle management

- Convert the subagent runner into a parent-scoped agents controller.
- Preserve send/thread/depth/model/thinking behavior while removing implicit and profile-driven delegated-request lifetime timeouts.
- Implement ownership-safe list and kill.
- Mark killed children and exclude them from reuse.
- Retry subtree disposal after partial kill cleanup and keep descendant traversal cycle-safe.
- Continue parent abort propagation and `subagent_session` emission.

**Verify:** router tests cover reuse, status transitions, foreign-ID rejection, active interruption, cleanup retry, cycle safety, and post-kill replacement.

### 3. Implement bounded observation

- Normalize child output events.
- Record them in a bounded router journal with monotonic sequence.
- Implement exact filters, strict timestamp validation, cursoring, ordering, limits, and optional details.
- Keep descending cursor pages oldest-unseen safe, report live-journal retention loss, and bound text/details.

**Verify:** deterministic unit tests cover every filter independently and combined, descending cursor exclusivity, truncation, ownership, retention loss, and byte bounds.

### 4. Update prompt/context and runtime inspection

- Mark `pibo_agents_*` as generated.
- Show the catalog once in the send tool's model-visible description.
- Update context inspector origins and token snapshots.
- Replace only mandatory legacy `codex-compat` wording.

**Verify:** context inspection and prompt tests show names/descriptions and no generated per-agent tools.

### 5. Preserve run and trace/UI integration

- Ensure all shared tools appear in `pibo_run_start.toolName`.
- Update trace materialization and delegation-card fixtures for shared send arguments.
- Keep child links and live delegation frames intact.
- Exercise all four management tools through the portable scoped-MCP path.

**Verify:** run-control, portable-MCP, and trace/UI suites pass; a yielded send can be waited/read.

### 6. Add debug CLI

- Add progressive `pibo debug agents --help` and command-level discovery.
- Implement persisted list and observe commands with matching filters.
- Stream persisted rows instead of materializing unbounded history and apply the live text/details bounds.
- Reject command options that would otherwise be silently ignored.

**Verify:** debug CLI tests cover help, list, combined filters, descending cursors, bounds, invalid options, foreign IDs, and JSON fields.

### 7. Preserve library compatibility

- Keep deprecated legacy tool-name, factory, and runner exports available.
- Keep deprecated runtime/session controller option shapes source-visible.
- Reject deprecated runtime assembly with a direct `agentsController` migration error.
- Continue recognizing historical generated tool names without assembling them in Pibo runtimes.

**Verify:** compatibility tests cover legacy factory behavior, generated-tool classification, and migration errors.

### 8. Full local verification

- Build TypeScript.
- Run focused suites.
- Run the complete repository test suite and lint/type checks used by CI.
- Inspect git diff for unrelated changes and obsolete references.

### 9. Pibo2 integrated validation

- Build the exact candidate package from this branch.
- Deploy only to the documented remote Pibo2 development server.
- Restart only the remote Pibo2 gateway through the documented helper/CLI workflow.
- Create a real Chat Web parent profile with at least `explorer` and `worker`, using `gpt-5.6-luna` and thinking `low`.
- Validate yielded send plus bounded wait/read, list, observe filters/cursor, kill, and child trace links; confirm that wait expiry leaves the delegated request running.
- Use the existing authenticated headful browser and capture CDP/visual evidence.

### 10. Delivery

- Record validation evidence under `docs/reports/`.
- Commit only task-related files.
- Push the focused branch.
- Update PR #556 with the exact reviewed head, local verification, and Pibo2 evidence.
- Merge only after authenticated GitHub checks confirm that exact head is ready.
