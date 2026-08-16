# Runtime Resource Materialization Validation — 2026-08-15

**Status:** Pass

**Branch:** `feature/agent-runtime-materialization`

**Stacked on:** portable-tools PR #483

**Pull request:** #486

**Final validated commit:** `2534740882c51b0825f24255defe4a8698b3973f`

**Primary implementation commit:** `6a1b9489178fff8687a394439a38bc708f76548b`

**Follow-up cleanup commit:** `2534740882c51b0825f24255defe4a8698b3973f`

## Outcome

Pibo now creates one router-owned runtime resource session per live session generation. The session contains only the selected skills, ordered context contributions, and external MCP definitions; shares its generation id with the portable-tool session; reports delivery mode/fidelity/status; and owns generated-state cleanup.

The final exact candidate passed local, package-level, authenticated API, service-restart, filesystem-isolation, and browser-rendering validation on Pibo2. No temporary custom agents, sessions, MCP fixture, or generated resource files remained after cleanup.

## Final candidate

| Item | Value |
|---|---|
| Package | `@pasko70/pibo@1.7.2` from the stacked feature branch |
| Commit | `2534740882c51b0825f24255defe4a8698b3973f` |
| Artifact | `/tmp/pibo-agent-runtime-materialization-pack-2534/pasko70-pibo-1.7.2.tgz` |
| Artifact SHA-256 | `07d444f8e6b3032c43494e9e0cdf5d57da15c7130ad215f60b78e83b1c587ae0` |
| Installed path | `/opt/pibo-candidates/agent-runtime-materialization/2534740882c51b0825f24255defe4a8698b3973f` |
| Final active PID | `395352` |
| Final public check | HTTP 200, 35 ms total |

The executable path and `PIBO_DEPLOY_CANDIDATE` / `PIBO_DEPLOY_COMMIT` service environment were checked immediately before and after final API validation. They remained on the exact candidate.

## Local verification

- `npm run typecheck`: passed.
- Focused resource, registry, MCP, router, gateway-channel, Context Build, and Web tests: passed.
- Final `npm test`: **1,645/1,645 passed across 12 suites**.
- Import-boundary tests include the generic resource and MCP-session modules.

Representative coverage is in:

- `test/agent-runtime-resource-service.test.mjs`
- `test/agent-runtime-registry.test.mjs`
- `test/agent-runtime-boundaries.test.mjs`
- `test/channel-runtime.test.mjs`
- `test/mcp-agent-context.test.mjs`
- `test/runtime-routed-session.test.mjs`
- `test/session-router-store.test.mjs`
- `test/web-channel.test.mjs`

## Exact-package integration

A deterministic integration script imported the installed package rather than the source worktree. It proved:

- one selected user skill and one selected context file were present;
- unselected skill, context, and MCP definitions were absent;
- the external MCP server completed protocol initialization;
- inventory returned tool `echo`, resource `fixture://pibo2`, and template `fixture://pibo2/{id}`;
- generated MCP config contained generated environment references but no resolved secret values;
- unrelated gateway environment did not reach the MCP child;
- Pi's scoped Bash could run the installed candidate's `pibo mcp` CLI and discover only the selected server/tool;
- missing secret variables caused strict runtime-resource startup failure;
- portable tools and runtime resources received the same generation id;
- disposal removed generated state.

The final safe result was:

```json
{
  "ok": true,
  "commit": "2534740882c51b0825f24255defe4a8698b3973f",
  "sourceConfigUnchanged": true,
  "generatedSecretValuesAbsent": true,
  "unrelatedGatewayEnvironmentAbsentFromMcpChild": true,
  "piScopedCliPassed": true,
  "strictFailurePassed": true,
  "sharedGenerationPassed": true,
  "cleanupPassed": true
}
```

## Authenticated Pibo2 API and Context Build

A temporary Pi custom agent selected:

- built-in skill `pi-agent-harness`;
- user skill `browser-tool-selection`;
- managed context `ctx:pibo-v2-server`;
- external MCP server `pibo2-materialization-fixture`.

Opening the session through authenticated `/api/chat/status` produced a bound Pi runtime using protocol `pi-sdk` version `0.80.6`. Authenticated Context Build returned:

- **45 total nodes**;
- approximately **4,932 tokens**;
- **0 warnings and 0 errors**;
- both selected skills as `DELIVERED / NATIVE / EXACT`;
- the managed context as `DELIVERED / NATIVE / EXACT`;
- the MCP server as `CONNECTED / MATERIALIZED:ISOLATED-PIBO-MCP-CONFIG / EXACT`;
- server identity `pibo2-final-materialization`;
- tool `final_echo`;
- resource `fixture://pibo2-final`;
- template `fixture://pibo2-final/{id}`;
- redacted secret-environment metadata and no resolved secret value in the response.

The generated live root was mode `0700`, its MCP config was mode `0600`, and generated config contained no resolved secret. The gateway process environment did not contain the fixture secret. Context Build's temporary inspection generation was removed before the response was checked.

The Pi catalog advertised:

```json
{
  "externalServers": {
    "support": "materialized",
    "modes": ["isolated-pibo-mcp-config"]
  },
  "statusInspection": true
}
```

An attempted custom agent with selected external MCP and disabled Bash was rejected with HTTP 400 and was not persisted.

## Exact-candidate restart and resume

A second temporary final-candidate session was opened with selected user skill, managed context, and MCP fixture. Before restart it had native Pi session id `2af96ff2-7bfc-4fcc-8f6d-a6f3e9f7a4fd` and one live resource generation.

After restarting `pibo-web.service`:

- PID changed from `394589` to `395352`;
- the old generation directory was removed;
- a new distinct generation was created when the session reopened;
- the same native Pi session id was preserved;
- binding remained `bound` and revision advanced from 2 to 3;
- Context Build again reported `CONNECTED / MATERIALIZED:ISOLATED-PIBO-MCP-CONFIG / EXACT`;
- MCP server identity and tool inventory remained available;
- no fixture secret appeared in the response;
- the service executable and deployment metadata still identified commit `2534740882c51b0825f24255defe4a8698b3973f`.

## Deletion cleanup defect found and fixed

Validation of the first implementation candidate `6a1b9489` found that permanent custom-agent deletion removed persistence but did not await disposal of an already-live router session. Its generated MCP config remained until a gateway restart.

The follow-up commit `25347408` changed channel deletion to await router disposal before deleting persistence and before returning the HTTP response. It added router, gateway-channel, and Web API regression coverage.

On the final exact candidate:

- agent archive returned HTTP 200;
- permanent delete returned HTTP 200;
- the Pibo Session binding immediately returned HTTP 404;
- the custom agent was absent from the catalog;
- live generation file count and live generation directory count were both zero before the delete response was considered complete;
- no gateway restart was required for cleanup.

## Browser evidence

`runtime-resource-delivery-final-pibo2-2026-08-15.png` shows the authenticated final-candidate Context Build with:

- user skill `browser-tool-selection` marked `ACTIVE / DELIVERED / NATIVE / EXACT`;
- one external MCP server marked `CONNECTED`;
- materialized isolated MCP delivery and exact fidelity;
- server, tool, resource, and template inventory;
- `secretEnvironmentKeys: [REDACTED]`;
- 45 nodes, approximately 4,932 tokens, zero warnings, and zero errors.

Screenshot SHA-256: `5f3ef14c9e8aa66113253fa896ca2408ca2d60e0327e2e86e39b87aaa5f38c73`.

The authenticated page rendered without browser console warnings or errors during the validation pass.

## Cleanup

Final checks confirmed:

- temporary agents and their sessions were deleted;
- temporary MCP fixture configuration was removed and the prior config restored;
- no validation state/backup/fixture files remained;
- no runtime resource files remained under Pibo Home;
- the final candidate remained active and public Chat Web returned HTTP 200.

## Remaining scope

- This milestone provides the adapter-neutral resource plan and proves Pi/native plus generic materialized delivery. Native Codex mapping into official App Server skill/config/instruction channels remains a later gated milestone.
- Connection verification is a bounded startup/preflight proof. Adapters with a long-lived native MCP connection may additionally report ongoing native status.
- Materialized adapters must declare `native-project-discovery` before profiles may enable automatic AGENTS.md / CLAUDE.md discovery; Pibo does not infer that capability.
- The separate real-model Pi parity gate remains blocked by the pre-existing `openai-codex` provider-authentication failure and is not treated as passing based on this resource-only validation.
