# Pibo VS Code Extension 1.4.1 — Release Report

## Why

Two regressions from 1.4.0 surfaced within hours of the release:

1. **`frame-src 'self'` block.** The empty-state shell called
   `window.location.replace(TARGET)` after a successful gateway health
   probe. VS Code 1.117.0+ treats top-level navigation inside a
   webview as `frame-src` and rejects any navigation to a
   non-`vscode-webview://` origin. The user landed on
   `chrome-error://chromewebdata/`.
2. **Room create 403.** The workspace-folder-watcher called the
   gateway directly via `fetch(baseUrl/api/chat/rooms)`. Without a
   session cookie and without the `x-pibo-socket-peer` header, the
   dev-auth plugin (or Better Auth) returned 401/403.

There is also a usability issue affecting Better Auth users: the
sidecar's dev-auth handshake cannot complete against a Better Auth
gateway (no local OAuth flow), so the inlined SPA never loads even
though the gateway is reachable. The shell now detects this case and
renders an actionable hint.

## What Changed

### Sidecar: explicit handshake probe

- `sidecar.tryHandshake()` runs the dev-auth handshake on demand and
  returns `false` when it cannot complete (e.g. Better Auth
  redirect).
- `sidecar.lastHandshakeError()` exposes the underlying error
  message so the host can show a useful hint.
- `forwardRequest` records the last handshake error so the host can
  surface it after the fact.

### Webview host: `swapToInlinedView` + shared cookie bridge

- `WebviewProvider.swapToInlinedView()` lets the shell request a
  swap from the host instead of navigating. The host re-probes the
  gateway through the sidecar (so it sees the same auth path the
  inlined SPA will use) and rebuilds the inlined HTML.
- The extension constructs a single `SidecarAuthBridge` at
  activation time. Both the sidecar (via the new
  `WebviewProviderOptions.cookieSource`) and the workspace-folder
  watcher share it. The bridge survives webview dispose / re-render
  cycles, so the session cookie is never re-minted on every
  re-resolve.
- A new message handler (`pibo/swap-to-inlined`) bridges the shell's
  postMessage to `swapToInlinedView()`. The shell listens for the
  result and surfaces failures inline.

### Room resolver: attach the cookie

- `resolveRoomForWorkspace` now takes a `CookieSource` option. When
  provided, the resolver attaches the dev-auth cookie to both the
  list and create requests so the gateway can identify the caller.
- The workspace-folder-watcher threads the shared bridge through to
  the resolver.
- When the handshake fails (e.g. Better Auth mode), the resolver
  gracefully falls back to a no-cookie request so the gateway's real
  status code is surfaced instead of a masked "auth handshake failed"
  error.

### Shell: postMessage swap, no top-level navigation

- The shell no longer calls `window.location.replace`. When the
  health probe succeeds, it posts `pibo/swap-to-inlined` to the
  extension host and waits for the result.
- A dedicated `<p id="hint">` element renders the dev-auth-mode
  hint when the swap fails.

### Docs

- Quickstart troubleshooting section now mentions the Better Auth
  vs dev-auth mode mismatch and how to start the gateway in the
  right mode (`pibo gateway:web --auth=local` or
  `auth.mode = local` in `~/.pibo/config.json`).

## Verification

- 68/68 tests pass across 8 suites (up from 57/57 in 1.4.0; the 11
  new tests cover the cookie attachment, swap flow, handshake probe,
  and shell postMessage path).
- `npm run typecheck` clean across all four tsconfigs.
- VSIX rebuilt via `node scripts/vscode-package.mjs` — 28 files,
  ~316 KB.

## Upgrade Notes

- The shared auth bridge means existing workspaces see no behavioural
  change once the gateway is in dev-auth mode.
- Users on Better Auth gateways must either switch to
  `--auth=local` or accept that the sidebar shows the empty-state
  shell with an actionable hint (the previous behaviour was a
  silent CSP-block chrome-error page).

## Files Touched

| File | Change |
|---|---|
| `src/apps/chat-vscode/extension/src/extension.ts` | Construct a single `SidecarAuthBridge` at activation, share via `cookieSource` |
| `src/apps/chat-vscode/extension/src/room-resolver.ts` | Accept `CookieSource`, attach cookie to outbound fetch calls |
| `src/apps/chat-vscode/extension/src/workspace-folder-watcher.ts` | Pass through `cookieSource` |
| `src/apps/chat-vscode/extension/src/sidecar.ts` | Add `tryHandshake()` and `lastHandshakeError()` |
| `src/apps/chat-vscode/extension/src/webview-host.ts` | Add `swapToInlinedView()`, share `cookieSource` with sidecar, listen for new message type |
| `src/apps/chat-vscode/extension/src/webview-shell.ts` | Replace `window.location.replace` with `pibo/swap-to-inlined` postMessage; render hint |
| `src/apps/chat-vscode/package.json` | Bump to 1.4.1 |
| `test/chat-vscode/room-resolver.test.mjs` | New tests for cookie attachment |
| `test/chat-vscode/sidecar.test.mjs` | New tests for `tryHandshake` |
| `test/chat-vscode/webview-host.test.mjs` | New tests for `swapToInlinedView` and cookieSource injection |
| `test/chat-vscode/webview-shell.test.mjs` | New tests for the postMessage flow and hint rendering |
| `docs/guides/pibo-vscode-ext-quickstart.md` | New troubleshooting entry for the Better Auth / dev-auth mismatch |