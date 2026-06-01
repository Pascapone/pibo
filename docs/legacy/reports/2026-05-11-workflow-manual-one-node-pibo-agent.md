# Workflow Manual Validation: One-node `pibo-agent`

**Date:** 2026-05-11 04:10 UTC  
**Task:** 14.4 — Run a manual one-node `pibo-agent` workflow  
**Result:** PASS

## Scope

Ran the minimal one-node workflow fixture `fixture.minimal-pibo-agent@1.0.0` through the workflow runtime in the Docker worker. The manual harness used the registry-backed fixed Agent Designer profile ref `pibo-agent`, routed the agent node through `createPiboSessionRoutingAgentExecutor`, persisted facts in a temporary `pibo-workflows.sqlite`, reopened the store, and inspected the completed run.

## Command

```sh
docker exec pibo-dev-Workflows bash -lc 'cd /workspace && npx tsx /tmp/manual-one-node-pibo-agent.mts'
```

The temporary script imported the public workflow package surface from `/workspace/packages/workflows/src/index.ts` and was removed after execution.

## Evidence

- Definition validation: `validateWorkflow(definition, { registry })` passed.
- Runtime path validation: `validateOneNodeAgentWorkflowPath(definition)` passed.
- Run id: `wfr_manual_one_node_pibo_agent`.
- Workflow id/version: `fixture.minimal-pibo-agent@1.0.0`.
- Final run status: `completed`.
- Current node: `answer` / `completed`.
- Selected profile: `pibo-agent`.
- Effective tools: `read`, `bash`, `edit`, `write`.
- Routed session metadata: `ps_manual_one_node_pibo_agent` / `pi_manual_one_node_pibo_agent`.
- Emitted workflow events: `workflow.started`, `node.started`, `node.completed`, `workflow.completed`.
- Persisted inspection after reopening the SQLite store reported one completed node attempt, zero wait tokens, zero edge transfers, and four events.

Compact inspection output:

```text
run	wfr_manual_one_node_pibo_agent
workflow	fixture.minimal-pibo-agent@1.0.0
status	completed
owner	user:manual-one-node
pibo_session	ps_manual_one_node_pibo_agent
current_node	answer
attempts	1	completed=1	failed=0	waiting=0
wait_tokens	0 pending
edge_transfers	0
events	4
updated	2026-05-11T04:10:00.000Z
```

## Notes

The Chat Web dev app was reachable at `http://127.0.0.1:4812/apps/chat`, and dev-auth session verification succeeded. The live Chat Web agent catalog in this worker currently exposes `pibo-kimi-coding` and `codex-compat-openai-web`; the `pibo-agent` name used by Workflow V1 is registered in the workflow fixture registry for this manual validation path.
