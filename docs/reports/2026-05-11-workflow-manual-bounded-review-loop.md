# Manual Workflow Validation: Bounded Review/Fix Loop

**Date:** 2026-05-11 04:14 UTC  
**Task:** 14.6 — Run a manual bounded review/fix loop with max attempts  
**Environment:** Docker worker `pibo-dev-Workflows`, `/workspace`

## Scenario

Validated the `fixture.bounded-review-loop` workflow with the fixture Workflow Registry providers. The manual harness executed one complete review/fix cycle:

1. Validate the workflow with registry-backed refs.
2. Start and persist a workflow run in a temporary `pibo-workflows.sqlite` database.
3. Dispatch the first `draft` agent node with a mocked `pibo-agent` executor.
4. Transfer `draft-to-review` and dispatch the `review` human wait.
5. Close and reopen the SQLite store at the wait boundary.
6. Resume the first wait with `approved: false`, verify the `needsRevision` guard, dispatch the `revise` code node, and transfer the bounded back-edge `revise-to-draft`.
7. Dispatch the second `draft` agent node, transfer to `review`, resume with `approved: true`, verify the guard no longer routes to revision, validate final workflow output, and mark the run completed.
8. Reopen the store and inspect persisted run facts with `inspectWorkflowRun(...)` / `formatWorkflowRunInspection(...)`.
9. Probe the draft node retry max-attempt policy: first retryable failure schedules attempt 2; attempt 2 exhausts because `maxAttempts` is 2.

## Evidence

Manual script command:

```bash
cd /workspace
npx tsx /tmp/manual-bounded-review-loop.ts
```

Key output:

```json
{
  "validationOk": true,
  "workflowId": "fixture.bounded-review-loop",
  "loopEdge": "revise-to-draft",
  "loopMaxAttempts": 3,
  "loopAttemptsUsed": 1,
  "finalStatus": "completed",
  "nodeAttempts": 5,
  "completedNodeAttempts": 5,
  "edgeTransfers": 3,
  "wakeups": 2,
  "retryProbe": {
    "firstFailureDecision": "retry",
    "scheduledAttempt": 2,
    "exhaustedDecision": "exhausted",
    "nodeRetryMaxAttempts": 2
  }
}
```

Formatted inspection summary:

```text
run	wfr_manual_bounded_review_loop
workflow	fixture.bounded-review-loop@1.0.0
status	completed
owner	user:manual-validation
pibo_session	ps_manual_2
current_node	review
attempts	5	completed=5	failed=0	waiting=0
wait_tokens	0 pending
edge_transfers	3
events	19
updated	2026-05-11T04:10:17.000Z
```

Persisted facts after restart included:

- 5 completed node attempts: `draft`, `review`, `revise`, `draft`, `review`.
- 3 edge transfers: first draft to review, bounded revise back-edge to draft, second draft to review.
- 2 resumed wait tokens and 2 human action records.
- 2 human wakeups from accepted resume actions.
- Completed run output: `{ "approved": true, "notes": "Approved after one bounded revision." }`.

## Result

Manual bounded review/fix loop validation passed. The loop used 1 of the configured 3 `revise-to-draft` attempts, completed after approval, and the node retry max-attempt probe confirmed bounded retry scheduling/exhaustion behavior.
