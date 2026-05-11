# Manual workflow validation: two-workflow composition with explicit adapter

**Date:** 2026-05-11 04:08 UTC  
**Task:** 14.5 Run a manual two-workflow composition with an explicit registered TypeScript adapter

## Summary

A temporary `npx tsx` harness was run inside the `pibo-dev-Workflows` Docker worker (`/workspace`) to validate a parent workflow that composes with a registered child workflow through an explicit registered TypeScript edge adapter.

The harness used:

- parent workflow: `manual.parent-adapted-child@1.0.0`
- child workflow: `manual.child-topic-summary@1.0.0`
- parent code node: `collect`
- parent edge adapter: `manual.adapters.textToTopic`
- parent nested workflow node: `child`
- child code node: `summarize`
- temporary SQLite store: `pibo-workflows.sqlite`
- restart-style validation: close/reopen `SqliteWorkflowRunStore`, then inspect parent and child runs with `inspectWorkflowRun(...)`

## Execution path

1. Registered the parent/child definitions, code handlers, and `manual.adapters.textToTopic` in a scoped `WorkflowRegistry`.
2. Validated both workflow definitions with `validateWorkflow(..., { registry })`.
3. Started the parent run and dispatched the `collect` code node.
4. Ran `transferWorkflowEdgeAdapterData(...)` on `collect-to-child`.
   - Source output was text.
   - Adapter output was JSON `{ topic: string }`.
   - Target input for the child workflow node was validated before dispatch.
5. Dispatched the parent `child` workflow node with `dispatchWorkflowNestedWorkflowNode(...)`.
6. The injected nested workflow executor created and persisted a child run, dispatched the child `summarize` code node, completed the child run, and returned the child output to the parent.
7. Completed the parent run, closed/reopened the store, and inspected both runs.

## Evidence

Parent inspection after store reopen:

```text
run	wfr_manual_parent_adapter
workflow	manual.parent-adapted-child@1.0.0
status	completed
owner	user:manual-validation
current_node	child
attempts	2	completed=2	failed=0	waiting=0
wait_tokens	0 pending
edge_transfers	1
events	7
updated	2026-05-11T04:10:07.000Z
```

Child inspection after store reopen:

```text
run	wfr_manual_child_adapter
workflow	manual.child-topic-summary@1.0.0
status	completed
owner	user:manual-validation
current_node	summarize
attempts	1	completed=1	failed=0	waiting=0
wait_tokens	0 pending
edge_transfers	0
events	4
updated	2026-05-11T04:10:06.000Z
```

Persisted adapted edge payload:

```json
{ "topic": "Compose a durable workflow validation note" }
```

Final parent output:

```json
{ "summary": "child summary for Compose a durable workflow validation note" }
```

## Result

The manual validation passed. It confirms that V1 can compose two workflows through a parent nested workflow node while using an explicit registered TypeScript adapter to bridge the parent node output into the child workflow input, with parent/child run facts and adapted edge transfer inspectable after reopening the workflow SQLite store.
