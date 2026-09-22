---
type: "Specification"
title: "Remote Agent Plugin Contract"
description: "Defines the implemented pibo.remote-agent plugin contract: room-scoped MCP access, module tools, observation reuse with documented deviations from pibo_agents_observe, auth lifecycle, and file/bash boundaries."
tags: ["remote-agent", "mcp", "plugins", "observation"]
status: "draft"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-22T13:01:57Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for REMOTE-001 to REMOTE-004"
implementation:
  state: "current"
  baseline_commit: "3b86d389cbf5f47a65d11d57a87478929c8d9d57"
  source_evidence: "performed"
  focused_test_execution: "66 focused shared-engine/consumer tests and 3 separate Remote source-policy characterizations passed; not a full Remote suite rerun"
  build_and_typecheck_execution: "targeted engine typecheck and 22-plugin build passed using fresh behavioral ESM emit; root typecheck remains resource-blocked; installation acceptance user-skipped"
traceability:
  commit: "3b86d389cbf5f47a65d11d57a87478929c8d9d57"
  requirements:
  - id: REMOTE-OBSERVE-001
    status: implemented
    sources:
    - path: src/remote-agent/modules/observe.ts
      symbol: buildObserveModuleTools
    - path: src/remote-agent/modules/observe.ts
      symbol: remoteObserveCursorScope
    - path: src/remote-agent/service.ts
      symbol: resolveRemoteObservation
    - path: src/agent-runtime/observations/observation-query.ts
      symbol: preparePiboAgentObservationQuery
    - path: src/agent-runtime/observations/observation-query.ts
      symbol: selectPiboAgentObservationPage
    - path: src/agent-runtime/observations/format.ts
      symbol: formatAgentObservationsForModel
    tests:
    - path: test/remote-agent-modules.test.mjs
      name: "observe module mirrors pibo_agents_observe: default view, cursors, paging"
    - path: test/remote-agent-modules.test.mjs
      name: "observe module returns full message text without a remote cap"
    - path: test/remote-agent-modules.test.mjs
      name: "observe module mirrors tool detail, identity, and content filters"
    - path: test/remote-agent-service.test.mjs
      name: "observe resolves full message and observation content"
    - path: test/observation-source-parity.test.mjs
      name: "remote positional cursors can repeat an old record and miss a late timestamp tie"
    - path: test/observation-source-parity.test.mjs
      name: "remote auto-cursors belong to session plus query, not an entitled token"
    - path: test/observation-source-parity.test.mjs
      name: "remote output limit does not bound record normalization work"
    failures:
    - Sessions outside the calling room are rejected with session_forbidden.
    - NUL text and literal or escaped NUL regex patterns are rejected.
    - Cursor, order, and limit stay bounded by the shared engine.
    confidence: high
  - id: REMOTE-SCOPE-002
    status: implemented
    sources:
    - path: src/remote-agent/types.ts
      symbol: REMOTE_AGENT_MODULES
    - path: src/remote-agent/types.ts
      symbol: REMOTE_AGENT_TOOL_NAMES
    - path: src/remote-agent/mcp-server.ts
      symbol: isRoomActive
    - path: src/remote-agent/mcp-server.ts
      symbol: closeRoomSessions
    - path: src/plugins/default-packages.ts
      symbol: remoteAgentPackageManifest
    tests:
    - path: test/remote-agent-mcp.test.mjs
      name: "MCP server rejects missing and invalid credentials"
    - path: test/remote-agent-mcp.test.mjs
      name: "MCP client lists and calls only its room modules"
    - path: test/remote-agent-mcp.test.mjs
      name: "MCP sessions stay bound to their own token"
    - path: test/remote-agent-mcp.test.mjs
      name: "disabled rooms are rejected even with a valid token"
    - path: test/remote-agent-modules.test.mjs
      name: "sessions module refuses cross-room access"
    failures:
    - Missing and invalid credentials are rejected.
    - Disabled rooms are rejected even with a valid token.
    - Cross-room and cross-token access is refused.
    confidence: high
  - id: REMOTE-AUTH-003
    status: implemented
    sources:
    - path: src/remote-agent/auth.ts
      symbol: revokeToken
    - path: src/remote-agent/auth.ts
      symbol: revokeRoomTokens
    tests:
    - path: test/remote-agent-auth.test.mjs
      name: "device code can be redeemed exactly once"
    - path: test/remote-agent-auth.test.mjs
      name: "tokens authenticate, expire after 30 days, and can be revoked"
    - path: test/remote-agent-auth.test.mjs
      name: "only hashes are persisted, never raw tokens"
    - path: test/remote-agent-service.test.mjs
      name: "room lifecycle: enable, code, redeem, disable revokes"
    failures:
    - Expired device codes are rejected.
    - Device codes for another room are rejected without burning the code.
    - Revoked tokens are rejected and listed.
    confidence: high
  - id: REMOTE-FILES-004
    status: implemented
    sources:
    - path: src/remote-agent/types.ts
      symbol: REMOTE_AGENT_MODULE_TOOLS
    - path: src/remote-agent/service.ts
      symbol: resolveRoomWorkspace
    tests:
    - path: test/remote-agent-modules.test.mjs
      name: "files module reads and writes through Pi tools"
    - path: test/remote-agent-modules.test.mjs
      name: "files module jails paths to the sandbox in sandbox mode"
    - path: test/remote-agent-modules.test.mjs
      name: "bash module runs commands with the room cwd"
    - path: test/remote-agent-workspace.test.mjs
      name: "new sessions start with the resolved room directory in every mode"
    failures:
    - Sandbox mode jails file paths to the sandbox.
    - Unknown modules are rejected for the pi runtime.
    - Bash and tools run with the resolved room working directory.
    confidence: high
---

# Remote Agent Plugin Contract

The `pibo.remote-agent` plugin exposes room-scoped remote access through one
loopback MCP endpoint serving all enabled rooms; room separation happens
through auth scope, never through per-room servers or room names in the URL.

## Observation parity (REMOTE-OBSERVE-001)

### Requirement: REMOTE-OBSERVE-001

`remote_session_observe` mirrors `pibo_agents_observe`: identical filters
(request/tool/agent/name/thread/event/kind/role/time/text/regex sets),
`cursorMode` auto/history, `afterSequence`, `order`, `limit` (1–200, default
20), `includeTools`/`toolDetail`/`includeDetails`, the same cursor scope key
under a `remote:`-namespaced scope in the shared auto-cursor table, and the
same paging, truncation, and model formatting. Payload resolution is complete
(payload, then inline, then preview); records carry real `toolCallId`,
`requestId`, and `turnId` values with per-event-type details. `textRegex`
needs the optional `rg` platform binary. The tool is read-only and rejects
sessions outside the calling room.

Filtering, normalization, regex matching, paging, shared types and formatting
are owned by `src/agent-runtime/observations/`. Remote Agent imports that
neutral engine directly, not the delegation implementation. Consumer-owned
source collection, positional sequence assignment and session/query cursor
persistence retain their existing behavior; this extraction is not a cursor
or scalability fix.

## Room and module scope (REMOTE-SCOPE-002)

### Requirement: REMOTE-SCOPE-002

Modules are exactly `sessions`, `observe`, `files`, and `bash`, with fixed
`remote_*` tool names. Every call is bound to one room and one token;
disabled rooms are rejected even with a valid token, and disabling a room
closes its MCP sessions and revokes its tokens. The plugin surface is a
catalog entry with views; there is no route area.

## Auth lifecycle (REMOTE-AUTH-003)

### Requirement: REMOTE-AUTH-003

Device codes redeem exactly once; tokens authenticate for 30 days and revoke
individually or per room. Only hashes persist, never raw tokens. Expired
codes and tokens are rejected and pruned.

## Files and bash boundaries (REMOTE-FILES-004)

### Requirement: REMOTE-FILES-004

File tools pass Pi read/write/edit/list/find/grep through and jail paths to
the sandbox in sandbox mode; bash runs with the resolved room working
directory. New sessions and tool contexts start in the room directory in
every mode. Kernel-level isolation is not claimed.

## Limitations

No cursor, scale, or security guarantees beyond the cited tests. The remote
MCP server is the room remote-access plugin; it is not the discarded K07 MCP
interaction proposal, and K07 stays attachments-only.

Independent B review (read-only, verdict APPROVE with notes, no blocker)
records these known limitations: F1 position sequences can duplicate or skip
at millisecond timestamp ties; F2 `roles:["user"]` matches remotely but not
in Pibo (superset); F3 each observe call full-scans the session (perf limit);
F6 remote and Pibo scopes share cursor-LRU eviction. F4 intended API breaks
for existing remote callers: newest-first default, auto-cursor returns only
new items on repeat, full texts instead of the 512 preview, new text format.
At that review, F5 gaps included preview-only fallback, payload-read-error
fallback and the F1-tie scenario. The characterization below now covers the
tie scenario; the other fallback gaps are not newly closed. Q3 duty tests:
`remote-agent-modules` observe-mirroring trio plus
`remote-agent-service` "observe resolves full message and observation
content".

Current characterization: F1 miss/duplicate probability is unmeasured (do
not trivialize it as guaranteed rare). A deterministic timestamp-tie test
now demonstrates that a late earlier-sorting record can be missed while an
old record repeats. F3: bounded output is not bounded work — source
collection and payload resolution precede query limits. The 2,048-record
characterization proves that normalization visits every message even with
`limit: 1`; it is not a backend throughput/load test. Large-history I/O and
performance acceptance remain open. F7: auto-cursors belong to session plus
normalized query, NOT to a token. A same-room module-boundary test now
proves shared consumption across two token contexts, independent session
and query scopes, history replay and a foreign-room rejection. This does
not replace the separate MCP authentication tests or promise token-isolated
cursors. No blanket error-free incremental observation is claimed.

The earlier 65/65 Remote suite and partial compiler result belong to
historical baseline `84101adce730983641bc4421c1e3cae982e129b7`; they are not
new candidate evidence. The September 22 focused runs and their explicit
limits are recorded in the implementation metadata above.
