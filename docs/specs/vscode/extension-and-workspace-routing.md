---
type: "Specification"
title: "VS Code Extension Commands and Workspace Routing"
description: "Defines the implemented VS Code extension command, workspace-folder, and Room-routing contract and its evidence limits."
tags:
  - "vscode"
  - "workspace-routing"
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T14:11:18.121Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:Foundation 38bb6e57f118c1543e7263c68d27e5103d3b1262"
    title: "Foundation source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-08-VSCODE"
  package_parent: "ca8de98aaf1a536006b9e5f0e3a070da1d5070bd"
  source_evidence: "performed"
  focused_test_execution: "recorded by the package implementation audit; it does not expand normative scope"
  build_typecheck_package_execution: "recorded by the package implementation audit; it does not expand normative scope"
  live_external_execution: "unperformed"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "VSCODE-EXTENSION-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-vscode/package.json"
          symbol: "contributes.commands"
        - path: "src/apps/chat-vscode/package.json"
          symbol: "contributes.views"
        - path: "src/apps/chat-vscode/package.json"
          symbol: "activationEvents"
        - path: "src/apps/chat-vscode/extension/src/extension.ts"
          symbol: "activate"
        - path: "src/apps/chat-vscode/extension/src/commands.ts"
          symbol: "registerCommands"
        - path: "src/apps/chat-vscode/extension/src/auth-bridge.ts"
          symbol: "createAuthBridge"
      source_inspected: true
      public:
        - "pibo.sessionPanel"
        - "pibo.newSession"
        - "pibo.deleteCurrentSession"
        - "pibo.renameCurrentSession"
        - "pibo.openInChatWeb"
        - "pibo.signIn"
      failures:
        - "Missing active Room blocks Chat Web open; command failures surface through VS Code messages or terminal creation errors."
        - "Sign-in and product operations delegate to provider/gateway surfaces; no database access is owned here."
        - "VS Code ^1.96.0 and Node >=24; provider login uses the integrated terminal available on the host platform."
      confidence: "high"
      follow_up: "Add a focused VS Code-shim test that activates the extension, asserts all five command registrations, and verifies each branch, including the informational-only delete/rename behavior; then run it through scripts/run-test-suite.mjs."
    - id: "VSCODE-EXTENSION-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-vscode/extension/src/room-resolver.ts"
          symbol: "canonicalizePath"
        - path: "src/apps/chat-vscode/extension/src/room-resolver.ts"
          symbol: "resolveRoomForWorkspace"
        - path: "src/apps/chat-vscode/extension/src/workspace-folder-watcher.ts"
          symbol: "createWorkspaceFolderWatcher"
        - path: "src/apps/chat-vscode/extension/webview/SessionSelector.tsx"
          symbol: "SessionSelector"
        - path: "src/apps/chat-vscode/extension/webview/SessionSelector.tsx"
          symbol: "RoomPickerView"
      tests:
        - path: "test/chat-vscode/room-resolver.test.mjs"
          name: "canonicalizePath returns an absolute path"
        - path: "test/chat-vscode/room-resolver.test.mjs"
          name: "0 matches → kind: single (auto-create) with 2 calls"
        - path: "test/chat-vscode/room-resolver.test.mjs"
          name: "2 rooms → kind: multiple, no picker call, no create call"
        - path: "test/chat-vscode/room-resolver.test.mjs"
          name: "1 room → kind: single, no create call"
        - path: "test/chat-vscode/room-resolver.test.mjs"
          name: "case-sensitive path matching"
        - path: "test/chat-vscode/session-selector.test.mjs"
          name: "renders the right view for the mode prop"
      public:
        - "GET /api/chat/rooms?workspace=..."
        - "POST /api/chat/rooms"
        - "Room picker selector mode"
      failures:
        - "Non-2xx list/create responses throw status-bearing errors; realpath failure falls back to an absolute path."
        - "Workspace values are URL-encoded and all Room reads/creates cross the authenticated gateway API."
        - "Canonicalization uses host path/realpath semantics and preserves platform case behavior."
      confidence: "high"
      follow_up: "Run the resolver and selector tests, then open zero-, one-, and duplicate-Room workspace fixtures in a headful VS Code instance and confirm gateway-visible Room selection."
    - id: "VSCODE-EXTENSION-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-vscode/extension/src/workspace-folder-watcher.ts"
          symbol: "createWorkspaceFolderWatcher"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "createWebviewHost"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "STATE_KEY_ROOM_ID"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "STATE_KEY_WORKSPACE"
      source_inspected: true
      public:
        - "pibo-vscode.activeRoomId workspaceState"
        - "pibo-vscode.activeWorkspace workspaceState"
        - "vscode.workspace.onDidChangeWorkspaceFolders"
      failures:
        - "Resolution errors show an error and preserve prior cached state."
        - "Cache contains Room/workspace identifiers only; product data remains gateway-owned."
        - "Uses VS Code workspace-folder ordering consistently on supported desktop hosts."
      confidence: "high"
      follow_up: "Add a watcher test with mocked workspaceState and folder-change events covering initial first-folder routing, add/remove, no-folder clearing, multiple-Room clearing, and failed-resolution retention."
    - id: "VSCODE-EXTENSION-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat-vscode/extension/src/extension.ts"
          symbol: "activate"
        - path: "src/apps/chat-vscode/extension/src/room-resolver.ts"
          symbol: "CookieSource"
        - path: "src/apps/chat-vscode/extension/src/room-resolver.ts"
          symbol: "buildAuthHeaders"
        - path: "src/apps/chat-vscode/extension/src/room-resolver.ts"
          symbol: "resolveRoomForWorkspace"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "wrapCookieSourceAsBridge"
      tests:
        - path: "test/chat-vscode/room-resolver.test.mjs"
          name: "attaches the dev-auth cookie from a CookieSource to the list and create requests"
        - path: "test/chat-vscode/room-resolver.test.mjs"
          name: "falls back to no-cookie requests when the CookieSource handshake fails"
        - path: "test/chat-vscode/webview-host.test.mjs"
          name: "when a cookieSource is provided, the sidecar receives a wrapped bridge and reuses the cookie"
        - path: "test/vscode-extension-local-auth.test.mjs"
          name: "vs code extension can list rooms without a cookie in local auth mode"
        - path: "test/vscode-extension-local-auth.test.mjs"
          name: "vs code extension can create a room without a cookie in local auth mode"
        - path: "test/vscode-extension-local-auth.test.mjs"
          name: "x-pibo-socket-peer header is stripped from the response body"
      public:
        - "Chat gateway Room APIs"
        - "Shared extension-host CookieSource"
      failures:
        - "Handshake failure degrades to a cookie-less request; gateway 401/403 or other non-2xx status remains visible."
        - "No direct SQLite access; the dev-auth cookie remains in extension-host memory and is attached only to gateway requests."
        - "Uses fetch-compatible HTTP behavior under the declared Node >=24 extension host."
      confidence: "high"
      follow_up: "Run the cookie-source tests, then validate local-auth success and Better Auth 401/403 behavior against disposable gateways without inspecting or modifying SQLite directly."
---
# VS Code Extension Commands and Workspace Routing

## Authority and evidence boundary

- Stable concept: `SPC-VSC-001`.
- Current-behavior authority: Foundation `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Raw-package parent: accepted commit `ca8de98aaf1a536006b9e5f0e3a070da1d5070bd`.
- Source and named-test locators identify regular Foundation blobs. Executed package checks prove candidate/parent parity only; they do not prove live or external behavior.
- This specification contains implemented current behavior only. Follow-ups and gaps are non-normative.

## Scope

### In scope

- The pibo.sessionPanel activity-bar webview registration and the five contributed extension commands.
- First-workspace-folder canonicalization and zero/one/many Room resolution through Chat gateway HTTP APIs.
- The workspaceState keys pibo-vscode.activeRoomId and pibo-vscode.activeWorkspace and their update behavior when workspace folders change.

### Out of scope

- Room, session, or SQLite persistence; the gateway and data specifications own product state.
- Sidecar proxying, webview CSP, postMessage handling, VSIX packaging, or pibo vscode install/status/uninstall; SPC-VSC-002 owns them.
- A folder picker for multi-root workspaces; current routing selects the first folder only.
- Delete and rename semantics themselves; the contributed commands only direct users to the sidebar session menu.

## Current behavior

### Public surfaces

- VS Code view pibo.sessionPanel.
- Commands pibo.newSession, pibo.deleteCurrentSession, pibo.renameCurrentSession, pibo.openInChatWeb, and pibo.signIn.
- Settings pibo.chatWebUrl, pibo.sidecar.port, and pibo.sidecar.gatewayProbeTimeoutMs; this target owns only chatWebUrl routing semantics.

### State

- Activation creates one shared sidecar auth bridge, one webview host, one workspace watcher, and one terminal-based provider login bridge.
- workspaceState stores the active Room ID and canonical workspace string; product data remains gateway-owned.

### Lifecycle

- Activation reads pibo.chatWebUrl, registers the webview provider and watcher, then registers commands.
- The watcher resolves the initial first folder. On additions it resolves event.added[0]; on removals it resolves the new first folder; no folder clears both state keys.
- Zero matching Rooms causes immediate creation, one selects directly, and many emits Room-picker mode without selecting one.

### Failure

- Canonicalization falls back from realpathSync to an absolute resolved path.
- List and create non-2xx responses throw status-bearing errors; watcher failures show an error and retain prior workspaceState.
- A failed auth-cookie handshake falls back to a cookie-less gateway request so the gateway's 401/403 remains visible.

### Security

- Room operations use gateway HTTP APIs and never read SQLite directly.
- The shared pibo_dev_session cookie remains in extension-host memory and is attached to list/create requests when available.
- Open-in-Chat-Web percent-encodes the Room ID before opening an HTTP(S) URL derived from configured baseUrl.

### Platform and compatibility

- Extension manifest requires VS Code ^1.96.0 and Node >=24.
- Multi-root compatibility is deliberately first-folder-only.
- Path matching preserves platform case behavior; the resolver does not lowercase paths.

## Requirements and invariants

## Requirement: VSCODE-EXTENSION-001: Current implemented contract

The VS Code extension MUST register pibo.sessionPanel and the five manifest commands; newSession switches selector mode, openInChatWeb requires an active Room, signIn opens a provider login terminal, and delete/rename remain sidebar guidance only.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-vscode/package.json:22` — `contributes.commands`; `src/apps/chat-vscode/package.json:58` — `contributes.views`; `src/apps/chat-vscode/package.json:18` — `activationEvents`; `src/apps/chat-vscode/extension/src/extension.ts:8` — `activate`; `src/apps/chat-vscode/extension/src/commands.ts:11` — `registerCommands`; `src/apps/chat-vscode/extension/src/auth-bridge.ts:12` — `createAuthBridge`
- Named tests: none. Source inspection is recorded explicitly; the follow-up below is non-normative.
- Public surfaces: `pibo.sessionPanel`; `pibo.newSession`; `pibo.deleteCurrentSession`; `pibo.renameCurrentSession`; `pibo.openInChatWeb`; `pibo.signIn`
- Failure boundary: Missing active Room blocks Chat Web open; command failures surface through VS Code messages or terminal creation errors.
- Security boundary: Sign-in and product operations delegate to provider/gateway surfaces; no database access is owned here.
- Platform and compatibility boundary: VS Code ^1.96.0 and Node >=24; provider login uses the integrated terminal available on the host platform.
- Confidence: **high**
- Evidence gap and follow-up: Add a focused VS Code-shim test that activates the extension, asserts all five command registrations, and verifies each branch, including the informational-only delete/rename behavior; then run it through scripts/run-test-suite.mjs.

#### Later validation commands

```text
npm run vscode:typecheck
node scripts/run-test-suite.mjs test/chat-vscode/integration.test.mjs
```


## Requirement: VSCODE-EXTENSION-002: Current implemented contract

The VS Code extension MUST canonicalize the selected workspace path, query Rooms by exact encoded workspace, auto-create on zero matches, select on one match, and expose all candidates on multiple matches.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-vscode/extension/src/room-resolver.ts:33` — `canonicalizePath`; `src/apps/chat-vscode/extension/src/room-resolver.ts:62` — `resolveRoomForWorkspace`; `src/apps/chat-vscode/extension/src/workspace-folder-watcher.ts:23` — `createWorkspaceFolderWatcher`; `src/apps/chat-vscode/extension/webview/SessionSelector.tsx:18` — `SessionSelector`; `src/apps/chat-vscode/extension/webview/SessionSelector.tsx:161` — `RoomPickerView`
- Exact named tests: `test/chat-vscode/room-resolver.test.mjs:11` — “canonicalizePath returns an absolute path”; `test/chat-vscode/room-resolver.test.mjs:16` — “0 matches → kind: single (auto-create) with 2 calls”; `test/chat-vscode/room-resolver.test.mjs:46` — “2 rooms → kind: multiple, no picker call, no create call”; `test/chat-vscode/room-resolver.test.mjs:71` — “1 room → kind: single, no create call”; `test/chat-vscode/room-resolver.test.mjs:94` — “case-sensitive path matching”; `test/chat-vscode/session-selector.test.mjs:69` — “renders the right view for the mode prop”
- Public surfaces: `GET /api/chat/rooms?workspace=...`; `POST /api/chat/rooms`; `Room picker selector mode`
- Failure boundary: Non-2xx list/create responses throw status-bearing errors; realpath failure falls back to an absolute path.
- Security boundary: Workspace values are URL-encoded and all Room reads/creates cross the authenticated gateway API.
- Platform and compatibility boundary: Canonicalization uses host path/realpath semantics and preserves platform case behavior.
- Confidence: **high**
- Evidence gap and follow-up: Run the resolver and selector tests, then open zero-, one-, and duplicate-Room workspace fixtures in a headful VS Code instance and confirm gateway-visible Room selection.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/chat-vscode/room-resolver.test.mjs test/chat-vscode/session-selector.test.mjs
```


## Requirement: VSCODE-EXTENSION-003: Current implemented contract

The VS Code extension MUST use only the first workspace folder, clear both cached keys when no folder remains, and replace or clear Room state after each successful single/multiple resolution; failed resolution leaves prior state unchanged.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-vscode/extension/src/workspace-folder-watcher.ts:23` — `createWorkspaceFolderWatcher`; `src/apps/chat-vscode/extension/src/webview-host.ts:108` — `createWebviewHost`; `src/apps/chat-vscode/extension/src/webview-host.ts:90` — `STATE_KEY_ROOM_ID`; `src/apps/chat-vscode/extension/src/webview-host.ts:91` — `STATE_KEY_WORKSPACE`
- Named tests: none. Source inspection is recorded explicitly; the follow-up below is non-normative.
- Public surfaces: `pibo-vscode.activeRoomId workspaceState`; `pibo-vscode.activeWorkspace workspaceState`; `vscode.workspace.onDidChangeWorkspaceFolders`
- Failure boundary: Resolution errors show an error and preserve prior cached state.
- Security boundary: Cache contains Room/workspace identifiers only; product data remains gateway-owned.
- Platform and compatibility boundary: Uses VS Code workspace-folder ordering consistently on supported desktop hosts.
- Confidence: **high**
- Evidence gap and follow-up: Add a watcher test with mocked workspaceState and folder-change events covering initial first-folder routing, add/remove, no-folder clearing, multiple-Room clearing, and failed-resolution retention.

#### Later validation commands

```text
npm run vscode:typecheck
code --extensionDevelopmentPath=src/apps/chat-vscode
```


## Requirement: VSCODE-EXTENSION-004: Current implemented contract

The VS Code extension MUST route Room and session product operations through authenticated gateway APIs, sharing one extension-host cookie source; if the dev-auth handshake fails, issue the Room request without a cookie and surface the gateway status.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-vscode/extension/src/extension.ts:8` — `activate`; `src/apps/chat-vscode/extension/src/room-resolver.ts:18` — `CookieSource`; `src/apps/chat-vscode/extension/src/room-resolver.ts:42` — `buildAuthHeaders`; `src/apps/chat-vscode/extension/src/room-resolver.ts:62` — `resolveRoomForWorkspace`; `src/apps/chat-vscode/extension/src/webview-host.ts:348` — `wrapCookieSourceAsBridge`
- Exact named tests: `test/chat-vscode/room-resolver.test.mjs:124` — “attaches the dev-auth cookie from a CookieSource to the list and create requests”; `test/chat-vscode/room-resolver.test.mjs:167` — “falls back to no-cookie requests when the CookieSource handshake fails”; `test/chat-vscode/webview-host.test.mjs:442` — “when a cookieSource is provided, the sidecar receives a wrapped bridge and reuses the cookie”; `test/vscode-extension-local-auth.test.mjs:63` — “vs code extension can list rooms without a cookie in local auth mode”; `test/vscode-extension-local-auth.test.mjs:77` — “vs code extension can create a room without a cookie in local auth mode”; `test/vscode-extension-local-auth.test.mjs:94` — “x-pibo-socket-peer header is stripped from the response body”
- Public surfaces: `Chat gateway Room APIs`; `Shared extension-host CookieSource`
- Failure boundary: Handshake failure degrades to a cookie-less request; gateway 401/403 or other non-2xx status remains visible.
- Security boundary: No direct SQLite access; the dev-auth cookie remains in extension-host memory and is attached only to gateway requests.
- Platform and compatibility boundary: Uses fetch-compatible HTTP behavior under the declared Node >=24 extension host.
- Confidence: **high**
- Evidence gap and follow-up: Run the cookie-source tests, then validate local-auth success and Better Auth 401/403 behavior against disposable gateways without inspecting or modifying SQLite directly.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/chat-vscode/room-resolver.test.mjs test/chat-vscode/webview-host.test.mjs
```


## Interfaces and ownership

### Owned capability IDs

- `pibo.vscode.extension`

### Public surfaces

- VS Code view pibo.sessionPanel.
- Commands pibo.newSession, pibo.deleteCurrentSession, pibo.renameCurrentSession, pibo.openInChatWeb, and pibo.signIn.
- Settings pibo.chatWebUrl, pibo.sidecar.port, and pibo.sidecar.gatewayProbeTimeoutMs; this target owns only chatWebUrl routing semantics.

### Linked owners

- [SPC-VSC-002](/specs/vscode/sidecar-webview-and-delivery.md) — linked owner; this specification does not duplicate its contract.
- [SPC-WEB-002](/specs/web/rooms-projects-and-session-trees.md) — linked owner; this specification does not duplicate its contract.
- [SPC-SEC-001](/specs/security/web-machine-and-dev-auth.md) — linked owner; this specification does not duplicate its contract.
## Evidence accounting

- Requirements: 4; confidence: 4 high, 0 medium, 0 low.
- Source-only requirements: 2; requirements with named tests: 2.
- Exact source locators: 20; exact named-test locators: 12.
- Reconciled stale-claim rejections: 5; preserved evidence gaps: 3.

| Evidence class | Rebound status | Boundary |
| --- | --- | --- |
| source inspection | performed | Manifest, activation, command, resolver, watcher, webview-state, and named test files were inspected at the baseline. |
| focused tests | unperformed | Named Node tests were inspected but not run. |
| build package checks | unperformed | Typecheck, build, and VSIX package checks were not run. |
| local real path pty headful browser validation | unperformed | No real workspace, VS Code host, or headful webview was opened. |
| external provider pibo2 acceptance | unperformed | No external provider or Pibo2 acceptance was run. |

The rebound statuses describe the input audit before this package's deterministic execution. The external and real-path gaps below remain unverified regardless of candidate/parent test parity.

## Reconciled stale-claim rejections

1. Reject claims that reload always skips resolution or always bypasses the Room picker: activation starts the watcher and resolves the first folder; cached state is only reused when rendering and its workspace string matches the non-canonical folder string.
2. Reject claims that every workspace folder is resolved; only the first folder or first added folder is used.
3. Reject claims that deleteCurrentSession and renameCurrentSession perform mutations; they only show informational messages.
4. Reject claims that selecting a Room calls pickRoom; the webview host stores the supplied Room ID directly and pickRoom is not wired into that path.
5. Reject any per-workspace database or <workspace>/.pibo state claim.

## Evidence gaps and non-normative follow-ups

1. No focused test covers activate, command registration, workspace-folder watcher state invalidation, or command behavior.
2. No source validation confirms that pibo/select-room carries a string Room ID before workspaceState is updated.
3. No headful VS Code acceptance was performed.

These gaps do not define intended behavior. Any implementation change requires a separate plan and later source/test reconciliation.

## Verification and traceability

- Every requirement traces to exact regular files at Foundation `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Named tests are identified by exact test names. Source-only requirements set `source_inspected: true` and carry a concrete follow-up.
- Deterministic wrappers, source guards, archive checks, and accelerated fixtures are bounded evidence. They are not substitutes for headful VS Code, real workspace activation, real PTY, live browser/CDP, provider, controller gateway, Docker runtime, release publication, deployment, or Pibo2 acceptance.
- Package execution results belong to the implementation audit, not to the normative current-behavior claim.

## Related concepts

- [SPC-VSC-002](/specs/vscode/sidecar-webview-and-delivery.md) — linked owner; this specification does not duplicate its contract.
- [SPC-WEB-002](/specs/web/rooms-projects-and-session-trees.md) — linked owner; this specification does not duplicate its contract.
- [SPC-SEC-001](/specs/security/web-machine-and-dev-auth.md) — linked owner; this specification does not duplicate its contract.
