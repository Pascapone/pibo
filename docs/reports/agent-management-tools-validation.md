# Shared Agent Management Tools Validation

**Date:** 2026-08-23
**Candidate commit:** `0b5a3ca3408847e97dfa06d88596f0de4466cba5`
**Candidate:** `agent-management-tools/0b5a3ca3`
**Package:** `@pasko70/pibo@1.7.2`
**Package SHA-256:** `ee4753f627ef743bab3e1252deaf00e8ce9410642624f65ddf9cda028a3583da`

## Scope

Validate the replacement of generated `pibo_subagent_*` tools with the stable shared surface:

- `pibo_agents_send_message`
- `pibo_agents_list_agents`
- `pibo_agents_observe`
- `pibo_agents_kill`

The validation also covered dynamic agent descriptions, child identity and thread reuse, yielded execution through `pibo_run_*`, persisted debug inspection, trace links, and the real headful Chat Web path.

## Local verification

The candidate passed:

- `npm run typecheck`
- `npm run build`
- `npm test`
- `git diff --check`

`npm run check:product-vocab` remains blocked by pre-existing baseline findings in generated Codex protocol schemas and unrelated historical room tests. No changed agent-management file was reported by that gate.

## Pibo2 deployment

The exact package was checksum-installed and activated on the remote Pibo2 development gateway. Post-activation evidence showed:

- active candidate `agent-management-tools`
- active commit `0b5a3ca3`
- gateway and public Chat Web readiness successful
- active yielded runs returned to zero after validation
- headful Chrome, Xvfb, Openbox, CDP, and the browser resource-reaper exemption remained healthy

## Fresh-session context audit

A temporary custom profile named `agent-tools-validation` was created with:

- runtime `pi`
- main model `openai-codex/gpt-5.6-luna`
- main reasoning `low`
- `runControl: true`
- delegated agents `explorer` and `worker`, both using `gpt-5.6-luna` at `low`
- distinct parent-visible descriptions for both delegated agents

Fresh Pibo Session: `ps_d4d88922-afa9-4ac9-a917-9adbb7b18267`

Authenticated context-build inspection returned:

- exactly four `pibo_agents_*` tools
- zero `pibo_subagent_*` tools
- all seven `pibo_run_*` tools
- `pibo_agents_send_message.name.enum = ["explorer", "worker"]`
- the exact configured explorer and worker descriptions in the send tool's model-visible description
- all four `pibo_agents_*` names in `pibo_run_start.toolName.enum`

## Real model validation

The real headful Chat Web UI displayed `openai-codex/gpt-5.6-luna low` for the fresh session. A model turn then completed the following sequence:

1. Started two tracked yielded `pibo_agents_send_message` runs.
2. Listed both child agents and retained their stable child Pibo Session IDs.
3. Waited for and read both yielded results.
4. Observed exactly the two child `assistant_message` events with combined name and event-type filters.
5. Killed the worker by exact `agentId`.
6. Listed agents again and reported worker `killed` and explorer `idle`.

Observed identities and results:

| Role | Run ID | Agent ID | Result |
|---|---|---|---|
| explorer | `run_63b648aa-5e9b-4d00-9189-bf4918c0f4db` | `ps_e909b79e-5564-4d55-801f-cef3b1248afb` | `EXPLORER_OK` |
| worker | `run_6ec84b03-3e31-462e-af8d-bc7e5a8f601b` | `ps_9cd81577-f3f4-43e0-9245-b9e8cade070d` | `WORKER_OK` |

The runtime observation result contained two matching observations and `nextAfterSequence: 31`.

A second model turn executed the remaining management tools through yielded run control:

| Tool | Run ID | Terminal status | Result fact |
|---|---|---|---|
| `pibo_agents_list_agents` | `run_89fe04d2-d68d-4074-8701-58d815a776d7` | completed | worker was `killed` |
| `pibo_agents_observe` | `run_828840b6-93e6-4956-9c59-7106445c6854` | completed | one filtered worker observation |
| `pibo_agents_kill` | `run_ce15cff8-c679-434c-8725-4b474de291f5` | completed | repeated kill was idempotent |

All five validation runs were persisted as `completed` and consumed. No active yielded run remained.

## Debug and trace validation

The exact candidate CLI exposed the progressive command surface:

```text
pibo debug agents <parent-session-id> list
pibo debug agents <parent-session-id> observe ...
```

Persisted list inspection returned:

- worker: `killed`, thread `validation-worker`, active model `gpt-5.6-luna`
- explorer: `idle`, thread `validation-explorer`, active model `gpt-5.6-luna`

Persisted observation inspection with `--name worker --event-type assistant_message` returned one exact worker reply and a stream cursor. Parent ownership filtering remained enforced by unit and integration tests.

`pibo debug trace <session> --check` reconstructed both asynchronous agent links and all shared management tool calls with:

- `nodeErrors: 0`
- `checks: ok`
- `issues: 0`

`pibo debug failures <session> --json` returned an empty failure list.

## Headful UI evidence

The real non-headless Pibo2 browser rendered:

- the selected `gpt-5.6-luna low` runtime state
- both asynchronous agent cards linked to child sessions
- all shared management tool calls
- both successful child reply markers
- observation count and cursor
- final worker `killed` state
- three completed yielded management-tool rows in the second turn

A viewport screenshot command completed successfully. Browser console inspection after both turns returned no warnings or errors.

## Result

The candidate satisfies the requested stable shared agent-management surface, dynamic model-visible catalog, owned-child lifecycle controls, precise observation filters, yielded execution, persisted debug inspection, trace linkage, and real headful `gpt-5.6-luna low` operation on Pibo2.
