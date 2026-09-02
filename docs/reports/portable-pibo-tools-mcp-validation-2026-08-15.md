---
type: "Evidence Report"
title: "Portable Pibo Tools and Session-Scoped MCP Validation — 2026-08-15"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/portable-pibo-tools-mcp-validation-2026-08-15.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "d8b5652858f9341728cd3b3389f4d2ac7a6018f0"
  source_bytes: 11135
  source_sha256: "72ff85ad222e5d392e2e82a065d3822d7a81f68e0ae47465d396fdba47969d47"
  source_body_sha256: "72ff85ad222e5d392e2e82a065d3822d7a81f68e0ae47465d396fdba47969d47"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:portable-pibo-tools-mcp-validation-2026-08-15"
  published_at: "2026-09-01T07:57:34Z"
---
# Portable Pibo Tools and Session-Scoped MCP Validation — 2026-08-15

**Status:** Passed for the portable-tool contract, Pi direct compiler, session-scoped MCP bridge, credential isolation, payload offloading, capability inspection, and authenticated Pibo2 UI/API validation.

## Scope

This report validates milestone 5 of the multi-agent runtime adapter change. It covers Pibo-owned tool definitions, backward-compatible plugin normalization, direct Pi compilation, router-owned portable-tool sessions, loopback Streamable HTTP MCP delivery, credential lifecycle and isolation, cancellation/progress/result fidelity, large-result storage, Agent Designer capability messaging, and Context Build ownership metadata.

It does not claim native Codex execution, selected skill/context/external-MCP materialization, or model-turn Pi parity. Those remain separate milestones. The existing Pibo2 provider-auth failure does not affect this tool-bridge validation because the exact-candidate integration drives the bridge through the runtime router without a model provider.

## Candidate

- Branch: `feature/agent-runtime-portable-tools`
- Stacked base: `5f6277f1` (`feature/agent-runtime-designer`, PR #479)
- Main implementation: `2fb920997b1a06d36bca7b2f4120363c31df432d`
- Final validated implementation commit: `20c3d82ddf596c4f4512a4d69087bf5cee0cf76c`
- Pull request: [#483](https://github.com/Pascapone/pibo/pull/483)
- Package: `@pasko70/pibo` `1.7.2`
- Package SHA-256: `e62ec3232ee6c79e24c48f2ac9b1fa65e109c8f18804e23bd578bed237bacc9d`
- Pibo2 candidate root: `/opt/pibo-candidates/agent-runtime-portable-tools/20c3d82ddf596c4f4512a4d69087bf5cee0cf76c`
- Exact-candidate validation window: 2026-08-15 09:10–09:12 UTC

## Implemented behavior

### Pibo-owned contract and Pi compatibility

- `PiboToolDefinition` owns the TypeBox/JSON-Schema input contract, optional structured-output schema, prompt metadata, execution mode, annotations, cancellation, progress, text/image content, structured data, errors, correlation metadata, and payload references.
- TypeBox `1.1.38` is now a direct dependency instead of relying on a Pi package re-export.
- Legacy Pi-shaped plugin definitions normalize structurally as `portable: false`. They continue to run through Pi with a native compatibility context but cannot be advertised through portable MCP.
- The Pi compiler maps Pibo definitions to Pi `ToolDefinition` values, preserving schema-derived inputs, prompt metadata, `prepareInput`, execution mode, updates, errors, images, details, and direct in-process execution.
- Pibo-owned gateway, subagent, run, goal, runtime, Codex-compatibility, browser, image-generation, and web-annotation tools now use the Pibo contract.
- One shared session tool-set assembler supplies both Pi direct execution and MCP delivery. Adapter-private native-yieldable tools remain direct-only and require the adapter's explicit `nativeToolYielding` capability.

### Router-owned portable sessions

- `PiboSessionRouter` creates one portable-tool session per live runtime generation and passes it through `AgentRuntimeOpenServices`.
- The session freezes Pibo Session id, Room id, profile, workspace, configured runtime instance, adapter id, selected tool set, and a random live generation id.
- Tool controllers and conversation providers may be attached after runtime creation without widening the selected profile tool set.
- Disposal revokes the generation's credentials, closes associated MCP sessions, removes the live session record, and stops the bridge when the owning service shuts down.

### Session-scoped MCP security

- The bridge uses the official MCP SDK's Streamable HTTP transport and refuses non-loopback bind addresses.
- Raw bearer credentials use a random 128-bit credential id plus a random 256-bit secret. Pibo retains the SHA-256 secret hash and compares presented hashes in constant time.
- The default lease is five minutes with a bounded 30-minute maximum lifetime. Renewal cannot widen scope or exceed that maximum.
- Each credential is bound to one Pibo Session, optional Room/profile metadata, configured runtime instance, adapter, live session generation, workspace, and sorted selected-tool allowlist.
- Every discovery and invocation rechecks the credential, active generation, current portable definition, and tool allowlist. MCP transport session ids are also bound to the credential that created them.
- Revocation, expiry, removed tools, stale generations, cross-session calls, and MCP-session hijacking fail without starting unauthorized tool work.
- Better Auth cookies, machine keys, gateway credentials, and harness auth are not reused by this bridge.

### Result fidelity and bounded storage

- Input and optional structured-output schemas are validated at the bridge boundary.
- MCP progress tokens map Pibo progress, totals, messages, content, and structured updates.
- Client cancellation aborts the Pibo tool execution signal.
- Text, inline images, structured content, tool errors, Pibo Session/runtime metadata, and generated tool-call correlation are returned through MCP.
- Oversized text, image, binary, and structured output use the existing durable `PayloadStore`; callers receive bounded previews and payload references rather than unbounded MCP responses.

### Inspection and Designer behavior

- Runtime capabilities distinguish Pibo-managed tool delivery from native-tool yielding. Pi reports Pibo-managed tools as `direct` and private native-tool yielding as `native`.
- The Agent Designer tool catalog exposes `portable` and `yieldable` independently and explains that run control covers Pibo-managed tools while private harness-native tools require adapter support.
- Context Build marks generated goal tools as Pibo-owned and reports their direct delivery mode instead of treating them as anonymous generated tools.

## Local verification

### Typecheck

Command:

```text
npm run typecheck
```

Result: passed at final commit `20c3d82d`.

### Focused coverage

The focused contract/session/MCP tests prove:

- schema-derived direct Pi compilation and portable result mapping;
- legacy Pi registration compatibility without a Pi type import at the generic boundary;
- one frozen session selection shared by direct and MCP delivery;
- non-loopback bind rejection;
- hashed credentials, normalized allowlists, renewal, expiry, generation revocation, and cleanup;
- unauthenticated request rejection;
- per-session tool discovery and cross-session invocation denial;
- private/non-portable tool exclusion;
- annotations, input/output validation, progress, images, structured content, errors, and correlation;
- durable large-result references and removed-tool rejection;
- client cancellation propagation;
- MCP-session hijack denial and stale-generation rejection;
- Context Build `PIBO` ownership for generated goal tools.

### Full suite

Command:

```text
npm test
```

Result at final commit: **1,639 passed, 0 failed** across 12 suites.

One earlier rerun inside a bounded yielded-run cgroup was stopped by the host memory-pressure guard (`memory full PSI avg10 9.05`); it did not report a test failure. The immediate direct exact-commit rerun completed with the passing result above.

## Pibo2 exact-candidate validation

### Candidate identity

The checksum-built package was installed under the candidate root listed above. Before and after authenticated API requests, the active `pibo-web.service` command line and environment identified:

```text
PIBO_DEPLOY_CANDIDATE=agent-runtime-portable-tools
PIBO_DEPLOY_COMMIT=20c3d82ddf596c4f4512a4d69087bf5cee0cf76c
```

This guard was necessary because other development work may replace the disposable Pibo2 candidate concurrently.

### Router and MCP integration

A real Node integration script imported the installed package from the exact candidate, created two persisted Pibo Sessions through `PiboSessionRouter`, registered a deterministic external-runtime fixture with MCP tool delivery, and exercised the official MCP client transport.

Observed result:

- the router supplied a portable-tool service to both runtime sessions;
- session A discovered only `portable_alpha`, `portable_large`, and `portable_slow`;
- session B discovered only `portable_beta`;
- session A calling session B's tool returned a scoped authorization error;
- using session B's credential with session A's MCP transport session id returned HTTP 403;
- progress delivered the expected `halfway` update;
- client cancellation reached the running tool's `AbortSignal`;
- a 160 KiB text result and a 160 KiB structured result became two durable payload rows;
- stored payload sizes were 163,840 bytes (`text/plain; charset=utf-8`) and 163,852 bytes (`application/json`);
- the MCP result returned two payload references and omitted the oversized structured body;
- explicit credential revocation made the next initialize request return HTTP 401;
- router disposal stopped the bridge and made its loopback endpoint unreachable.

The integration removed its temporary database, payload files, and script after completion.

### Authenticated catalog and Context Build

Authenticated public Pibo2 API requests returned:

- 6 profiles and one configured runtime instance;
- 16 registered Pibo Native Tools, all with an explicit boolean portability value and all reported portable;
- Pi tool capabilities `{ piboManaged: direct, nativeToolYielding: native }`;
- runtime diagnostic `pi_runtime_available`;
- a frozen `base · pi/pi` Context Build with 6 top-level nodes, 39 total nodes, approximately 3,864 tokens, 0 warnings, and 0 errors;
- `create_goal`, `get_goal`, and `update_goal` marked `ACTIVE`, `GENERATED`, and `PIBO`, with direct delivery metadata;
- inspectable input schemas in the expanded tool nodes.

### Browser evidence

Authenticated Chrome loaded the exact final candidate and rendered:

- Pi's separate `PIBO TOOLS direct` and `NATIVE TOOL YIELDING native` capability cards;
- tool-level `portable / yieldable` and `portable / direct only` labels;
- package-level `portable package` versus `portable + runtime-native` messaging;
- Context Build `PIBO` badges on generated goal tools.

Evidence:

- `docs/reports/portable-tools-agent-designer-pibo2-2026-08-15.png`
- `docs/reports/portable-tools-catalog-pibo2-2026-08-15.png`
- `docs/reports/portable-tools-designer-pibo2-2026-08-15.png`
- `docs/reports/portable-tools-context-build-pibo2-2026-08-15.png`

The captures exclude account details and secrets.

## Compatibility and remaining work

- Existing Pi direct tool behavior remains covered by the full suite and the explicit compiler/legacy-definition tests.
- No existing Pi-backed `codex` profile or runtime meaning changed.
- No raw MCP credential or hash is persisted in session bindings, payload metadata, screenshots, or this report.
- Native Codex remains gated on the separately required real-model Pi parity proof.
- Selected skills, context files, and external MCP server materialization are milestone 6 and are not implied by this report.
- Runtime-neutral history/debug and the adapter-authoring skill remain subsequent milestones.
