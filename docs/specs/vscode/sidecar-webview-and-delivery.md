---
type: "Specification"
title: "VS Code Sidecar, Webview, and Delivery"
description: "Defines the implemented VS Code sidecar, webview, VSIX packaging, and extension-management contract and its evidence limits."
tags:
  - "vscode"
  - "sidecar"
  - "delivery"
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T14:11:18.311Z"
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
    - id: "VSCODE-SIDECAR-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "createSidecar"
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "DEFAULT_SIDECAR_PORT"
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "HEALTH_PROBE_TIMEOUT_MS"
        - path: "src/apps/chat-vscode/extension/src/sidecar-auth.ts"
          symbol: "createSidecarAuthBridge"
        - path: "src/apps/chat-vscode/extension/src/sidecar-auth.ts"
          symbol: "DEV_AUTH_COOKIE_NAME"
        - path: "src/apps/chat-vscode/extension/src/sidecar-auth.ts"
          symbol: "DEV_AUTH_HANDSHAKE_TIMEOUT_MS"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "createWebviewHost"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "stopActiveSidecar"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "wrapCookieSourceAsBridge"
      tests:
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "start binds to 127.0.0.1 and serves /health from the configured gateway"
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "falls back to port 0 when the requested port is busy"
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "stop() drains in-flight slow requests"
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "createSidecar throws a clear error when no authBridge is provided"
        - path: "test/chat-vscode/sidecar-auth.test.mjs"
          name: "getCookieHeader runs the handshake lazily on the first call"
        - path: "test/chat-vscode/sidecar-auth.test.mjs"
          name: "reset clears the cached token so the next call re-handshakes"
      public:
        - "127.0.0.1 sidecar"
        - "Sidecar.start/stop/port/isHealthy/tryHandshake"
        - "/health and /status"
      failures:
        - "Missing auth bridge throws; configured-port EADDRINUSE retries on port 0; startup/health failure renders diagnostics."
        - "Bind only 127.0.0.1 and retain only the pibo_dev_session value in extension-host memory."
        - "Node >=24 networking; port 0 fallback avoids host-specific fixed-port conflicts."
      confidence: "high"
      follow_up: "Run sidecar/auth tests and a real VS Code disposal/reload scenario; inspect listener address, fallback mapping, cookie non-disclosure, and shutdown timing."
    - id: "VSCODE-SIDECAR-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-vscode/extension/src/inlined-chat-html.ts"
          symbol: "buildInlinedChatHtml"
        - path: "src/apps/chat-vscode/extension/src/inlined-chat-html.ts"
          symbol: "listBundleAssetNames"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "createWebviewHost"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "renderView"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "swapToInlinedView"
        - path: "src/apps/chat-vscode/extension/src/webview-host.ts"
          symbol: "attachMessageHandler"
        - path: "src/apps/chat-vscode/extension/src/webview-shell.ts"
          symbol: "buildWebviewShellHtml"
        - path: "src/apps/chat-vscode/extension/src/webview-shell.ts"
          symbol: "generateNonce"
        - path: "src/apps/chat-vscode/extension/src/postmessage-rpc.ts"
          symbol: "isWebViewToHostMessage"
        - path: "src/apps/chat-vscode/extension/webview/ChatTerminalApp.tsx"
          symbol: "ChatTerminalApp"
      tests:
        - path: "test/chat-vscode/inlined-chat-html.test.mjs"
          name: "buildInlinedChatHtml inlines the JS and CSS with a nonce and a <base> tag"
        - path: "test/chat-vscode/inlined-chat-html.test.mjs"
          name: "escapes </script>, <!--, and --> inside the JS body"
        - path: "test/chat-vscode/inlined-chat-html.test.mjs"
          name: "buildInlinedChatHtml throws when the bundle is missing"
        - path: "test/chat-vscode/webview-host.test.mjs"
          name: "when the sidecar reports healthy and the bundle is present, serves the inlined HTML with a port-mapped base href"
        - path: "test/chat-vscode/webview-host.test.mjs"
          name: "when the sidecar fails to start, serves the shell HTML with a diagnostic"
        - path: "test/chat-vscode/webview-host.test.mjs"
          name: "swapToInlinedView returns a hint when the gateway is reachable but in Better Auth mode (handshake fails)"
        - path: "test/chat-vscode/integration.test.mjs"
          name: "inliner produces ~800 KB of HTML for the real chat-vscode bundle"
      public:
        - "Inlined Chat webview"
        - "Empty-state shell and swap result"
        - "Host/webview postMessage union"
      failures:
        - "Missing bundle, sidecar startup, health, or Better Auth handshake failures render a diagnostic/hint rather than a working app."
        - "CSP nonce and URI checks apply, but unsafe-inline/eval and partial branch-local postMessage checks are current limitations."
        - "CommonJS extension host with Vite webview assets and VS Code 1.117+ port mapping."
      confidence: "high"
      follow_up: "Run inliner/host/shell tests, add negative postMessage tests for malformed Room IDs and terminal commands, then perform headful CSP, focus, keyboard, and reload acceptance in VS Code."
    - id: "VSCODE-SIDECAR-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "createSidecar"
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "ALLOWED_ORIGIN_PATTERN"
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "PROXIED_REQUEST_TIMEOUT_MS"
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "PROXIED_REQUEST_BODY_LIMIT"
        - path: "src/apps/chat-vscode/extension/src/sidecar.ts"
          symbol: "SOCKET_DRAIN_TIMEOUT_MS"
        - path: "src/apps/chat-vscode/extension/src/sidecar-auth.ts"
          symbol: "buildProxiedHeaders"
      tests:
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "proxies a GET /api/... request to the gateway and forwards the response"
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "proxies a POST request with body intact"
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "responds to CORS preflight from a vscode-webview:// origin"
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "rejects a non-OPTIONS request from a non-vscode-webview origin with 403"
        - path: "test/chat-vscode/sidecar.test.mjs"
          name: "streams an SSE response 1:1 without buffering"
        - path: "test/chat-vscode/sidecar-auth.test.mjs"
          name: "buildProxiedHeaders strips hop-by-hop and internal headers and injects the cookie"
      public:
        - "Sidecar gateway proxy"
        - "SSE forwarding"
        - "CORS preflight"
      failures:
        - "Return 403 for rejected origins, 413 over 5 MiB, 504 after 30 seconds, and 502 for auth/upstream failures."
        - "Require loopback peers; accept the implemented /^vscode-webview:\\/\\/[^/]+$/ boundary (or missing Origin), strip sensitive/hop-by-hop headers, and inject the in-memory cookie."
        - "Node HTTP streaming on loopback; no browser-specific configured-ID comparison is implemented."
      confidence: "high"
      follow_up: "Add focused tests for 5 MiB+1 rejection, 30-second abort using fake timers, missing Origin acceptance, mismatched vscode-webview IDs, and client-close abort; then run the sidecar test file."
    - id: "VSCODE-SIDECAR-004"
      status: "implemented"
      sources:
        - path: "scripts/vscode-build.mjs"
          symbol: "copyDirectory"
        - path: "scripts/vscode-build.mjs"
          symbol: "run"
        - path: "scripts/vscode-build.mjs"
          symbol: "run(\"node\", [\"./node_modules/vite/bin/vite.js\""
        - path: "scripts/vscode-build.mjs"
          symbol: "\"./node_modules/.bin/esbuild\""
        - path: "scripts/vscode-build.mjs"
          symbol: "copyDirectory(webviewOutDir, sidecarBundleOutDir)"
        - path: "scripts/vscode-package.mjs"
          symbol: "copyDirectory"
        - path: "scripts/vscode-package.mjs"
          symbol: "run"
        - path: "scripts/vscode-package.mjs"
          symbol: "expectedFilename"
        - path: "scripts/vscode-package.mjs"
          symbol: "targetPath"
        - path: "scripts/vscode-package.mjs"
          symbol: "latestPath"
        - path: "src/vscode/vsix-fetcher.ts"
          symbol: "fetchRelease"
        - path: "src/vscode/vsix-fetcher.ts"
          symbol: "downloadVsixAsset"
        - path: "src/vscode/vsix-fetcher.ts"
          symbol: "fetchLatestVsix"
        - path: "src/vscode/install.ts"
          symbol: "resolveVsixArtifact"
        - path: "src/vscode/install.ts"
          symbol: "runInstall"
        - path: "src/vscode/status.ts"
          symbol: "runStatus"
        - path: "src/vscode/status.ts"
          symbol: "formatStatusText"
        - path: "src/vscode/uninstall.ts"
          symbol: "runUninstall"
        - path: "src/vscode/code-cli.ts"
          symbol: "SUPPORTED_CODE_BINARIES"
        - path: "src/vscode/code-cli.ts"
          symbol: "detectCodeBinary"
        - path: "src/vscode/code-cli.ts"
          symbol: "runCodeCommand"
        - path: "src/vscode/code-cli.ts"
          symbol: "listInstalledExtensions"
      tests:
        - path: "test/vscode/vsix-fetcher.test.mjs"
          name: "parses GitHub release payloads and fetches VSIX assets"
        - path: "test/vscode/install.test.mjs"
          name: "resolves and installs the Pibo VS Code extension"
        - path: "test/vscode/code-cli.test.mjs"
          name: "detects code binary and parses code CLI output"
        - path: "test/vscode/uninstall.test.mjs"
          name: "uninstalls the Pibo VS Code extension or reports not-installed"
      public:
        - "npm run vscode:package"
        - "pibo vscode install|status|uninstall"
        - "dist/apps/vscode-artifacts/*.vsix"
      failures:
        - "Reject artifacts over 64 MiB after download; propagate fetch/package/CLI errors; normalize uninstall not-found to not-installed."
        - "Download size is bounded, but no checksum/signature is verified; URL/release trust remains external."
        - "Detect code, code-insiders, or codium; npm/npx wrappers support cmd.exe, but Windows acceptance is unperformed."
      confidence: "high"
      follow_up: "Run all test/vscode files explicitly because root npm test omits that directory; add size-cap and checksum-policy tests; package, inspect, install, status, and uninstall the VSIX on Linux and Windows fixtures."
---
# VS Code Sidecar, Webview, and Delivery

## Authority and evidence boundary

- Stable concept: `SPC-VSC-002`.
- Current-behavior authority: Foundation `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Raw-package parent: accepted commit `ca8de98aaf1a536006b9e5f0e3a070da1d5070bd`.
- Source and named-test locators identify regular Foundation blobs. Executed package checks prove candidate/parent parity only; they do not prove live or external behavior.
- This specification contains implemented current behavior only. Follow-ups and gaps are non-normative.

## Scope

### In scope

- The extension-host loopback sidecar, dev-auth cookie bridge, port-mapped webview origin, inlined Chat shell, and host/webview message boundary.
- The VS Code-specific SessionSelector and reuse of Chat terminal/composer semantics.
- VSIX build/package layout and pibo vscode install/status/uninstall behavior.

### Out of scope

- Gateway auth policy, Room/session APIs, Chat terminal semantics, or gateway static-asset serving.
- Marketplace publication guarantees; current release output only prints a manual upload instruction.
- Host setup's code-server-based vscode-web component, which is distinct from this desktop extension.
- A cryptographic VSIX trust chain; current downloading is size-bounded but has no checksum or signature verification.

## Current behavior

### Public surfaces

- 127.0.0.1 sidecar /health and /status plus gateway proxy paths.
- Port-mapped https://<webviewId>.vscode-resource.vscode-cdn.net:<port> base origin.
- Host/webview messages for selector mode, refresh, Room selection, external URLs, terminal commands, and shell-to-inlined swap.
- pibo vscode install|status|uninstall and the pibo-vscode-ext-<version>.vsix artifact.

### State

- The sidecar and pibo_dev_session token are process-memory state scoped to extension activation/webview lifetime.
- Downloaded VSIX bytes and last-installed.json live under PIBO_HOME/vscode/cache by default.
- Build output is copied to src/apps/chat-vscode/dist/chat-vscode-web and the release VSIX directory.

### Lifecycle

- Start on 127.0.0.1 at the requested port, fall back to an OS-assigned port on EADDRINUSE, map that actual port, and stop on webview disposal with a bounded drain.
- Probe gateway reachability; render inlined HTML when reachable or an empty shell otherwise; shell swap explicitly runs the dev-auth handshake before replacing HTML.
- Install resolves local path, URL, cached latest tag, or GitHub Release; invokes code/code-insiders/codium with --install-extension --force; status is best-effort and uninstall maps not-found output to not-installed.

### Failure

- Missing sidecar auth bridge fails construction; startup and bundle failures render a diagnostic shell.
- Auth handshake failures return 502 on proxied requests; oversized requests return 413; timeout returns 504; other gateway failures return 502.
- Missing CLI, release, VSIX asset, file, or nonzero code invocation returns a structured failed install result.

### Security

- Listener binding is loopback-only and peers are checked for loopback.
- CORS accepts the implemented ^vscode-webview://[^/]+$ boundary. It does not compare the origin's ID to the configured webviewId, and requests with no Origin are accepted.
- Proxy request bodies are capped at 5 MiB after buffering, upstream requests at 30 seconds, drain at 5 seconds, and hop-by-hop/internal/cookie headers are filtered before the in-memory cookie is injected.
- External open accepts only strings beginning http:// or https://. Terminal messages accept any non-empty command string and execute it in a VS Code terminal. Room IDs are not runtime-type-checked.

### Platform and compatibility

- The extension targets VS Code ^1.96.0, Node >=24, CommonJS extension output, and the VS Code 1.117+ port-mapping/CSP model.
- VSIX CLI detection checks bare filesystem entries named code, code-insiders, or codium on PATH; native Windows/PATHEXT behavior has no focused acceptance evidence.
- Package scripts choose cmd.exe/npm.cmd/npx.cmd on Windows, but no Windows VSIX package/install test was performed.

## Requirements and invariants

## Requirement: VSCODE-SIDECAR-001: Current implemented contract

The VS Code sidecar and delivery surface MUST create one loopback sidecar per active webview, require an auth bridge, lazily retain only the pibo_dev_session value in extension-host memory, fall back to port 0 when the configured port is busy, and drain on disposal.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-vscode/extension/src/sidecar.ts:121` — `createSidecar`; `src/apps/chat-vscode/extension/src/sidecar.ts:40` — `DEFAULT_SIDECAR_PORT`; `src/apps/chat-vscode/extension/src/sidecar.ts:41` — `HEALTH_PROBE_TIMEOUT_MS`; `src/apps/chat-vscode/extension/src/sidecar-auth.ts:65` — `createSidecarAuthBridge`; `src/apps/chat-vscode/extension/src/sidecar-auth.ts:25` — `DEV_AUTH_COOKIE_NAME`; `src/apps/chat-vscode/extension/src/sidecar-auth.ts:26` — `DEV_AUTH_HANDSHAKE_TIMEOUT_MS`; `src/apps/chat-vscode/extension/src/webview-host.ts:108` — `createWebviewHost`; `src/apps/chat-vscode/extension/src/webview-host.ts:131` — `stopActiveSidecar`; `src/apps/chat-vscode/extension/src/webview-host.ts:348` — `wrapCookieSourceAsBridge`
- Exact named tests: `test/chat-vscode/sidecar.test.mjs:86` — “start binds to 127.0.0.1 and serves /health from the configured gateway”; `test/chat-vscode/sidecar.test.mjs:111` — “falls back to port 0 when the requested port is busy”; `test/chat-vscode/sidecar.test.mjs:381` — “stop() drains in-flight slow requests”; `test/chat-vscode/sidecar.test.mjs:411` — “createSidecar throws a clear error when no authBridge is provided”; `test/chat-vscode/sidecar-auth.test.mjs:89` — “getCookieHeader runs the handshake lazily on the first call”; `test/chat-vscode/sidecar-auth.test.mjs:115` — “reset clears the cached token so the next call re-handshakes”
- Public surfaces: `127.0.0.1 sidecar`; `Sidecar.start/stop/port/isHealthy/tryHandshake`; `/health and /status`
- Failure boundary: Missing auth bridge throws; configured-port EADDRINUSE retries on port 0; startup/health failure renders diagnostics.
- Security boundary: Bind only 127.0.0.1 and retain only the pibo_dev_session value in extension-host memory.
- Platform and compatibility boundary: Node >=24 networking; port 0 fallback avoids host-specific fixed-port conflicts.
- Confidence: **high**
- Evidence gap and follow-up: Run sidecar/auth tests and a real VS Code disposal/reload scenario; inspect listener address, fallback mapping, cookie non-disclosure, and shutdown timing.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/chat-vscode/sidecar.test.mjs test/chat-vscode/sidecar-auth.test.mjs
```


## Requirement: VSCODE-SIDECAR-002: Current implemented contract

The VS Code sidecar and delivery surface MUST build a CSP-bearing HTML document that inlines the packaged Vite JS/CSS, maps its base URL to the sidecar, renders a diagnostic shell on startup/health/bundle failure, and handle the implemented host/webview message branches with their current branch-local checks.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-vscode/extension/src/inlined-chat-html.ts:81` — `buildInlinedChatHtml`; `src/apps/chat-vscode/extension/src/inlined-chat-html.ts:230` — `listBundleAssetNames`; `src/apps/chat-vscode/extension/src/webview-host.ts:108` — `createWebviewHost`; `src/apps/chat-vscode/extension/src/webview-host.ts:251` — `renderView`; `src/apps/chat-vscode/extension/src/webview-host.ts:303` — `swapToInlinedView`; `src/apps/chat-vscode/extension/src/webview-host.ts:445` — `attachMessageHandler`; `src/apps/chat-vscode/extension/src/webview-shell.ts:52` — `buildWebviewShellHtml`; `src/apps/chat-vscode/extension/src/webview-shell.ts:8` — `generateNonce`; `src/apps/chat-vscode/extension/src/postmessage-rpc.ts:8` — `isWebViewToHostMessage`; `src/apps/chat-vscode/extension/webview/ChatTerminalApp.tsx:47` — `ChatTerminalApp`
- Exact named tests: `test/chat-vscode/inlined-chat-html.test.mjs:44` — “buildInlinedChatHtml inlines the JS and CSS with a nonce and a <base> tag”; `test/chat-vscode/inlined-chat-html.test.mjs:65` — “escapes </script>, &lt;!&#45;&#45;, and &#45;&#45;&gt; inside the JS body”; `test/chat-vscode/inlined-chat-html.test.mjs:85` — “buildInlinedChatHtml throws when the bundle is missing”; `test/chat-vscode/webview-host.test.mjs:200` — “when the sidecar reports healthy and the bundle is present, serves the inlined HTML with a port-mapped base href”; `test/chat-vscode/webview-host.test.mjs:279` — “when the sidecar fails to start, serves the shell HTML with a diagnostic”; `test/chat-vscode/webview-host.test.mjs:398` — “swapToInlinedView returns a hint when the gateway is reachable but in Better Auth mode (handshake fails)”; `test/chat-vscode/integration.test.mjs:14` — “inliner produces ~800 KB of HTML for the real chat-vscode bundle”
- Public surfaces: `Inlined Chat webview`; `Empty-state shell and swap result`; `Host/webview postMessage union`
- Failure boundary: Missing bundle, sidecar startup, health, or Better Auth handshake failures render a diagnostic/hint rather than a working app.
- Security boundary: CSP nonce and URI checks apply, but unsafe-inline/eval and partial branch-local postMessage checks are current limitations.
- Platform and compatibility boundary: CommonJS extension host with Vite webview assets and VS Code 1.117+ port mapping.
- Confidence: **high**
- Evidence gap and follow-up: Run inliner/host/shell tests, add negative postMessage tests for malformed Room IDs and terminal commands, then perform headful CSP, focus, keyboard, and reload acceptance in VS Code.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/chat-vscode/inlined-chat-html.test.mjs test/chat-vscode/webview-host.test.mjs test/chat-vscode/webview-shell.test.mjs test/chat-vscode/integration.test.mjs
code --extensionDevelopmentPath=src/apps/chat-vscode
```


## Requirement: VSCODE-SIDECAR-003: Current implemented contract

The VS Code sidecar and delivery surface MUST proxy gateway requests and SSE through loopback with the implemented vscode-webview:// origin boundary, 5 MiB buffered request limit, 30-second upstream timeout, cookie/header replacement, streaming response forwarding, and bounded shutdown.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-vscode/extension/src/sidecar.ts:121` — `createSidecar`; `src/apps/chat-vscode/extension/src/sidecar.ts:34` — `ALLOWED_ORIGIN_PATTERN`; `src/apps/chat-vscode/extension/src/sidecar.ts:36` — `PROXIED_REQUEST_TIMEOUT_MS`; `src/apps/chat-vscode/extension/src/sidecar.ts:37` — `PROXIED_REQUEST_BODY_LIMIT`; `src/apps/chat-vscode/extension/src/sidecar.ts:38` — `SOCKET_DRAIN_TIMEOUT_MS`; `src/apps/chat-vscode/extension/src/sidecar-auth.ts:162` — `buildProxiedHeaders`
- Exact named tests: `test/chat-vscode/sidecar.test.mjs:163` — “proxies a GET /api/... request to the gateway and forwards the response”; `test/chat-vscode/sidecar.test.mjs:191` — “proxies a POST request with body intact”; `test/chat-vscode/sidecar.test.mjs:223` — “responds to CORS preflight from a vscode-webview:// origin”; `test/chat-vscode/sidecar.test.mjs:256` — “rejects a non-OPTIONS request from a non-vscode-webview origin with 403”; `test/chat-vscode/sidecar.test.mjs:282` — “streams an SSE response 1:1 without buffering”; `test/chat-vscode/sidecar-auth.test.mjs:142` — “buildProxiedHeaders strips hop-by-hop and internal headers and injects the cookie”
- Public surfaces: `Sidecar gateway proxy`; `SSE forwarding`; `CORS preflight`
- Failure boundary: Return 403 for rejected origins, 413 over 5 MiB, 504 after 30 seconds, and 502 for auth/upstream failures.
- Security boundary: Require loopback peers; accept the implemented /^vscode-webview:\/\/[^/]+$/ boundary (or missing Origin), strip sensitive/hop-by-hop headers, and inject the in-memory cookie.
- Platform and compatibility boundary: Node HTTP streaming on loopback; no browser-specific configured-ID comparison is implemented.
- Confidence: **high**
- Evidence gap and follow-up: Add focused tests for 5 MiB+1 rejection, 30-second abort using fake timers, missing Origin acceptance, mismatched vscode-webview IDs, and client-close abort; then run the sidecar test file.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/chat-vscode/sidecar.test.mjs test/chat-vscode/sidecar-auth.test.mjs
```


## Requirement: VSCODE-SIDECAR-004: Current implemented contract

The VS Code sidecar and delivery surface MUST build and package a versioned VSIX plus latest.vsix, resolve install artifacts from local path, URL, cache, or GitHub Release, enforce a 64 MiB download cap without checksum verification, and manage the extension through detected code/code-insiders/codium CLIs.

### Acceptance and boundaries

- Exact source evidence: `scripts/vscode-build.mjs:28` — `copyDirectory`; `scripts/vscode-build.mjs:45` — `run`; `scripts/vscode-build.mjs:50` — `run("node", ["./node_modules/vite/bin/vite.js"`; `scripts/vscode-build.mjs:53` — `"./node_modules/.bin/esbuild"`; `scripts/vscode-build.mjs:67` — `copyDirectory(webviewOutDir, sidecarBundleOutDir)`; `scripts/vscode-package.mjs:38` — `copyDirectory`; `scripts/vscode-package.mjs:32` — `run`; `scripts/vscode-package.mjs:63` — `expectedFilename`; `scripts/vscode-package.mjs:79` — `targetPath`; `scripts/vscode-package.mjs:85` — `latestPath`; `src/vscode/vsix-fetcher.ts:75` — `fetchRelease`; `src/vscode/vsix-fetcher.ts:110` — `downloadVsixAsset`; `src/vscode/vsix-fetcher.ts:135` — `fetchLatestVsix`; `src/vscode/install.ts:99` — `resolveVsixArtifact`; `src/vscode/install.ts:148` — `runInstall`; `src/vscode/status.ts:49` — `runStatus`; `src/vscode/status.ts:95` — `formatStatusText`; `src/vscode/uninstall.ts:22` — `runUninstall`; `src/vscode/code-cli.ts:17` — `SUPPORTED_CODE_BINARIES`; `src/vscode/code-cli.ts:38` — `detectCodeBinary`; `src/vscode/code-cli.ts:57` — `runCodeCommand`; `src/vscode/code-cli.ts:121` — `listInstalledExtensions`
- Exact named tests: `test/vscode/vsix-fetcher.test.mjs:137` — “parses GitHub release payloads and fetches VSIX assets”; `test/vscode/install.test.mjs:265` — “resolves and installs the Pibo VS Code extension”; `test/vscode/code-cli.test.mjs:105` — “detects code binary and parses code CLI output”; `test/vscode/uninstall.test.mjs:80` — “uninstalls the Pibo VS Code extension or reports not-installed”
- Public surfaces: `npm run vscode:package`; `pibo vscode install|status|uninstall`; `dist/apps/vscode-artifacts/*.vsix`
- Failure boundary: Reject artifacts over 64 MiB after download; propagate fetch/package/CLI errors; normalize uninstall not-found to not-installed.
- Security boundary: Download size is bounded, but no checksum/signature is verified; URL/release trust remains external.
- Platform and compatibility boundary: Detect code, code-insiders, or codium; npm/npx wrappers support cmd.exe, but Windows acceptance is unperformed.
- Confidence: **high**
- Evidence gap and follow-up: Run all test/vscode files explicitly because root npm test omits that directory; add size-cap and checksum-policy tests; package, inspect, install, status, and uninstall the VSIX on Linux and Windows fixtures.

#### Later validation commands

```text
npm run vscode:package
node scripts/run-test-suite.mjs test/vscode/code-cli.test.mjs test/vscode/install.test.mjs test/vscode/uninstall.test.mjs test/vscode/vsix-fetcher.test.mjs
pibo vscode install --vsix dist/apps/vscode-artifacts/latest.vsix --json
```


## Interfaces and ownership

### Owned capability IDs

- `pibo.vscode.sidecar`
- `pibo.vscode.ui-delivery`

### Public surfaces

- 127.0.0.1 sidecar /health and /status plus gateway proxy paths.
- Port-mapped https://<webviewId>.vscode-resource.vscode-cdn.net:<port> base origin.
- Host/webview messages for selector mode, refresh, Room selection, external URLs, terminal commands, and shell-to-inlined swap.
- pibo vscode install|status|uninstall and the pibo-vscode-ext-<version>.vsix artifact.

### Linked owners

- [SPC-GW-003](/specs/gateway/web-host-and-channel.md) — linked owner; this specification does not duplicate its contract.
- [SPC-SEC-001](/specs/security/web-machine-and-dev-auth.md) — linked owner; this specification does not duplicate its contract.
- [SPC-OP-003](/specs/operator/terminal-ui.md) — linked owner; this specification does not duplicate its contract.
- [SPC-DEL-001](/specs/delivery/package-build-install-deploy-release.md) — linked owner; this specification does not duplicate its contract.

## Evidence accounting

- Requirements: 4; confidence: 4 high, 0 medium, 0 low.
- Source-only requirements: 0; requirements with named tests: 4.
- Exact source locators: 47; exact named-test locators: 23.
- Reconciled stale-claim rejections: 6; preserved evidence gaps: 4.

| Evidence class | Rebound status | Boundary |
| --- | --- | --- |
| source inspection | performed | Sidecar, auth, host, inliner, webview, package/install/status/uninstall, build/package scripts, and named tests were inspected. |
| focused tests | unperformed | Named tests were inspected but not run. |
| build package checks | unperformed | No typecheck, webview build, extension bundle, VSIX package, or installed-artifact check was run. |
| local real path pty headful browser validation | unperformed | No sidecar/webview flow was driven in a real headful VS Code instance. |
| external provider pibo2 acceptance | unperformed | No external provider, Marketplace, GitHub Release, or Pibo2 acceptance was run. |

The rebound statuses describe the input audit before this package's deterministic execution. The external and real-path gaps below remain unverified regardless of candidate/parent test parity.

## Reconciled stale-claim rejections

6. Reject checksum-verified or signature-verified VSIX download claims; downloadVsixAsset only enforces a 64 MiB post-download size cap.
7. Reject an invented configured-webview-ID origin match. The implemented CORS boundary accepts any no-slash vscode-webview:// origin and accepts missing Origin headers.
8. Reject claims that postMessage RPC is fully schema-validated; attachMessageHandler performs branch-local checks only, and isWebViewToHostMessage is unused and omits open-terminal and swap-to-inlined.
9. Reject the sidecar-auth comment that a 401 triggers one automatic refresh; no response-status retry exists in the implementation.
10. Reject automatic Marketplace publication or a guaranteed pibo.pibo-vscode ID; the manifest currently derives pibo.pibo-vscode-ext and release output instructs manual upload.
11. Reject claims that the VSIX webview fetches its UI bundle from the gateway; current VSIX packaging copies and inlines the bundle from context.extensionPath.

## Evidence gaps and non-normative follow-ups

4. The 5 MiB request cap, 30-second timeout, missing-Origin acceptance, and configured-ID non-check lack focused tests.
5. No checksum/signature metadata is parsed or verified for VSIX downloads, and the size cap is not tested.
6. No test covers terminal-command allowlisting because no allowlist exists.
7. No headful VS Code, Windows, Marketplace, or external-provider acceptance was performed.

These gaps do not define intended behavior. Any implementation change requires a separate plan and later source/test reconciliation.

## Verification and traceability

- Every requirement traces to exact regular files at Foundation `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Named tests are identified by exact test names. Source-only requirements set `source_inspected: true` and carry a concrete follow-up.
- Deterministic wrappers, source guards, archive checks, and accelerated fixtures are bounded evidence. They are not substitutes for headful VS Code, real workspace activation, real PTY, live browser/CDP, provider, controller gateway, Docker runtime, release publication, deployment, or Pibo2 acceptance.
- Package execution results belong to the implementation audit, not to the normative current-behavior claim.

## Related concepts

- [SPC-GW-003](/specs/gateway/web-host-and-channel.md) — linked owner; this specification does not duplicate its contract.
- [SPC-SEC-001](/specs/security/web-machine-and-dev-auth.md) — linked owner; this specification does not duplicate its contract.
- [SPC-OP-003](/specs/operator/terminal-ui.md) — linked owner; this specification does not duplicate its contract.
- [SPC-DEL-001](/specs/delivery/package-build-install-deploy-release.md) — linked owner; this specification does not duplicate its contract.
