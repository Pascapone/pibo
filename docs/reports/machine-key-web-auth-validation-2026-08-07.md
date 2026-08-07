# Machine-key Web authentication validation

**Date:** 2026-08-07  
**Branch:** `feature/machine-key-web-auth`  
**Base:** `upstream/dev` at `8e6df91f4f8afaac78debf8ef474850a9ffef978`

## Outcome

The focused implementation passed isolated and production-path Pibo2 candidate validation. It has not been released.

Confirmed locally:

- a 256-bit raw key is generated in the versioned `pibo_mk_...` format;
- only a SHA-256 digest and identity metadata enter the server record;
- record and secret outputs are mode `0600`;
- group/world-readable stores are rejected;
- valid keys map to the linked Pibo user identity;
- malformed, altered, expired, revoked, and disallowed-email keys do not authenticate;
- revocation hot-reloads without replacing the gateway;
- Google/Better Auth remains the fallback when no valid machine key is present;
- `pibo auth` provides progressive machine-key discovery and redacted operator commands.

## Focused validation

Commands:

```bash
npm run typecheck
npm run build
node --test \
  test/machine-key-auth.test.mjs \
  test/machine-key-auth-cli.test.mjs \
  test/better-auth-config.test.mjs \
  test/config.test.mjs \
  test/auth-mode-config.test.mjs
```

Result:

- Typecheck: passed.
- Production build: passed.
- Focused tests: 24 passed, 0 failed.

## End-to-end local gateway proof

A fresh Better Auth gateway ran on `127.0.0.1:4918/4919` with an isolated `PIBO_HOME`.

Observed:

| Scenario | Result |
| --- | --- |
| `/health` | HTTP 200 |
| Chat bootstrap without key | HTTP 401 |
| Chat bootstrap with malformed key | HTTP 401 |
| Chat bootstrap with valid key | HTTP 200 |
| Returned identity provider | `machine-key` |
| Event stream with valid key | HTTP 200 and initial SSE event |

The authenticated fresh-home bootstrap was 161,567 bytes and completed in about 45 ms on loopback.

## Full-suite comparison

The feature worktree full suite completed with:

- tests: 1,348;
- passed: 1,323;
- failed: 25.

A clean detached `upstream/dev` worktree, installed and built independently, completed with:

- tests: 1,339;
- passed: 1,314;
- failed: 25.

The normalized failure-name sets were identical. The feature added nine passing tests and no new full-suite failure name.

Existing baseline failures include:

- VS Code host tests unable to resolve the `vscode` module in the standalone test process;
- one gateway restart-safety test colliding with the already-running local dev gateway;
- Terminal View fixture IDs differing from expected IDs;
- four unrelated workflow/project bootstrap assertions.

These failures are not treated as passed and should be addressed in focused work, especially the Terminal View fixture mismatches required by the wider Pibo2 goal.

## Pibo2 validation

Production before candidate deployment:

- Pibo version: `1.10.1`;
- Production gateway: reachable, mode `prod`, restart safety idle;
- app-shell public TTFB: approximately 31-49 ms across ten samples;
- authenticated bootstrap body: 219,692 bytes;
- authenticated bootstrap TTFB: first two samples 3.50-3.67 s, then approximately 1.84-1.97 s;
- installed browser: Google Chrome 148.

Backup and rollback evidence:

- archive: `/root/.pibo/server-backups/31.70.66.85-pibo-20260807T004600Z.tar.zst`;
- SHA-256: `69881f86953b93630e96293df5c0d0afbf9cb5116a6d5f51a32d40e02f0c4ba1`;
- size: 3,482,330,859 bytes;
- archive extraction succeeded;
- all 15 restored SQLite databases passed `PRAGMA quick_check`.

The candidate was installed separately below `/opt/pibo-candidates` and activated through a rollbackable systemd override. The globally installed Pibo `1.10.1` package was not replaced. The active candidate commit was `a9974a2e`.

Public production-path checks passed for:

| Scenario | Result |
| --- | --- |
| Existing Google session | authenticated |
| Valid `X-Pibo-Machine-Key` | authenticated as the linked existing identity |
| Missing or malformed key | HTTP 401 without a human session |
| Machine-session exchange | secure signed cookie issued |
| Cookie-only Chat bootstrap | authenticated as provider `machine-key` |
| Event stream with machine cookie | connected successfully |
| Key revocation | header and existing cookie rejected without gateway restart |
| Key restoration | authentication resumed without gateway restart |

The raw key remained in a mode-`0600` controller credential file. The server received only the hash-only record. Browser profiles lived in `/dev/shm` and contained only the short-lived signed cookie.

## Browser and real-agent proof

A non-headless Chrome 148 process ran as the unprivileged `pibo-browser` account on Xvfb/Openbox. CDP remained bound to server loopback and was forwarded to controller loopback. Chrome DevTools MCP `0.14.0` attached to the authenticated browser.

Verified through the public URL:

- Chat bootstrap identified provider `machine-key`;
- the authenticated Chat UI rendered the linked user and composer;
- screenshots, accessibility snapshots, console data, network requests, DOM state, and performance traces were captured;
- `openai-codex` completed a real `pibo-agent-v2` turn;
- the turn streamed model reasoning and server tool execution through the Web UI.

Local evidence is retained under `docs/reports/artifacts/pibo2-machine-auth-2026-08-07/` but large binary traces are intentionally excluded from the review branch.

## Performance observations outside auth scope

The authenticated workflow exposed separate Chat UI performance issues:

- authenticated bootstrap commonly required approximately 1.8-2.0 seconds after warm-up;
- one reload trace measured LCP at 3.09 seconds, with approximately 99.5% attributed to render delay;
- the rendered page contained 2,831 DOM elements;
- the Terminal View working indicator mutates individual random characters roughly every 50-100 ms;
- one optimistic steering send cleared the composer but did not enter the durable message/event stream.

These observations do not block the machine-auth contract. They require focused UI/runtime changes and separate validation.

## Remaining delivery gates

1. Publish the focused branch and open the upstream PR against `dev`.
2. Keep the rollbackable candidate available while review continues.
3. Do not release until the wider Chat UI/runtime defects are handled or explicitly accepted.
