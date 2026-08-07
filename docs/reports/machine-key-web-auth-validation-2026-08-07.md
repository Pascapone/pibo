# Machine-key Web authentication validation

**Date:** 2026-08-07  
**Branch:** `feature/machine-key-web-auth`  
**Base:** `upstream/dev` at `8e6df91f4f8afaac78debf8ef474850a9ffef978`

## Outcome so far

The focused implementation is ready for isolated Pibo2 candidate deployment.

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

## Pibo2 pre-deployment baseline

Production before candidate deployment:

- Pibo version: `1.10.1`;
- Production gateway: reachable, mode `prod`, restart safety idle;
- app-shell public TTFB: approximately 31-49 ms across ten samples;
- authenticated bootstrap body: 219,692 bytes;
- authenticated bootstrap TTFB: first two samples 3.50-3.67 s, then approximately 1.84-1.97 s;
- `openai-codex`: reported configured by the live provider-auth action;
- installed Chrome: Google Chrome 148;
- no active display or CDP target was available.

The configured provider status is not yet proof that the OpenAI token can complete a model turn. That requires the planned real-agent validation.

## Remaining gates

1. Complete and restore-test the current Pibo2 backup.
2. Package and install the branch as an isolated server candidate.
3. Provision a hash-only Pibo2 machine record while retaining the raw key only on the controller.
4. Verify public bootstrap, SSE, invalid-key rejection, and revocation.
5. Establish a non-headless Chrome display and CDP connection.
6. Complete a real OpenAI-backed streaming turn through the Web UI.
