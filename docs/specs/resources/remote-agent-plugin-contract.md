---
type: "Specification"
title: "Remote Agent Plugin Contract"
description: "Defines the implemented pibo.remote-agent plugin contract: room-scoped MCP access, module tools, observation parity with pibo_agents_observe, auth lifecycle, and file/bash boundaries."
tags: ["remote-agent", "mcp", "plugins", "observation"]
status: "draft"
authority: "normative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T16:35:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for REMOTE-001 to REMOTE-004"
implementation:
  state: "current"
  baseline_commit: "84101adce730983641bc4421c1e3cae982e129b7"
  source_evidence: "performed"
  focused_test_execution: "performed isolated: 65 of 65 test/remote-agent-*.test.mjs passed, 0 failed"
  build_and_typecheck_execution: "partially performed: tsc emit passed; full typecheck reports one pre-existing unrelated chat-ui TS2322 in composer-send.ts on a merge-untouched file"
traceability:
  commit: "84101adce730983641bc4421c1e3cae982e129b7"
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
    - path: src/subagents/observation-query.ts
      symbol: preparePiboAgentObservationQuery
    - path: src/subagents/observation-query.ts
      symbol: selectPiboAgentObservationPage
    - path: src/subagents/tool.ts
      symbol: formatAgentObservationsForModel
    tests:
    - path: test/remote-agent-modules.test.mjs
      name: "observe module mirrors pibo_agents_observe: default view, cursors, paging"
    - path: test/remote-agent-modules.test.mjs
      name: "observe module returns full message text without a remote cap"
    - path: test/remote-agent-modules.test.mjs
      name: "observe module mirrors tool detail, identity, and content filters"
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
F5 minor test gaps (preview-only fallback, payload-read-error fallback,
F1-tie scenario) are documented, not retested here. Q3 duty tests:
`remote-agent-modules` observe-mirroring trio plus
`remote-agent-service` "observe resolves full message and observation
content".
