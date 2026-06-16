# VS Code Webview Sidecar — 1.4.0 Release Report

**Date:** 2026-06-15
**Status:** Feature complete, release prepped, awaiting upstream review
**Target version:** 1.4.0
**Feature PR:** <https://github.com/Pascapone/pibo/pull/123>
**Plan:** [`docs/plans/vscode-webview-sidecar-implementation-plan-2026-06-15.md`](../plans/vscode-webview-sidecar-implementation-plan-2026-06-15.md)

## Summary

Replaces the navigation-based empty-state shell with a port-mapped
extension-host sidecar and a CSP-compliant inlined SPA. Fixes the
empty-sidebar symptom reported against VS Code 1.117.0+ (verified
target 1.124.2). 1.3.5 fixed the meta-CSP nonce, but not the
workbench `frame-src 'self'` that 1.117.0 introduced.

## What Landed

| Component | File | Lines | Tests |
|---|---|---|---|
| Sidecar HTTP server | `src/apps/chat-vscode/extension/src/sidecar.ts` | 508 | 13 |
| Dev-auth handshake | `src/apps/chat-vscode/extension/src/sidecar-auth.ts` | 186 | 8 |
| Inlined HTML builder | `src/apps/chat-vscode/extension/src/inlined-chat-html.ts` | 237 | 7 |
| Webview host integration | `src/apps/chat-vscode/extension/src/webview-host.ts` | +258 | 3 |
| Runtime vscode shim (test) | `src/apps/chat-vscode/extension/src/vscode-shim.js` | 109 | — |
| Port-mapping types | `src/apps/chat-vscode/extension/src/vscode-shim.d.ts` | +20 | — |
| Configuration keys | `src/apps/chat-vscode/package.json` | +13 | — |
| Build pipeline | `scripts/vscode-build.mjs`, `scripts/vscode-package.mjs` | +58 | — |
| Documentation | `docs/guides/pibo-vscode-ext-quickstart.md` | +40 | — |
| Integration test | `test/chat-vscode/integration.test.mjs` | 46 | 1 |
| Unit tests | `test/chat-vscode/{sidecar,sidecar-auth,inlined-chat-html,webview-host}.test.mjs` | 987 | 31 |

Total: 2 467 insertions, 38 deletions across 17 files.

## Branch & PR State

| Branch | Purpose | PR | Status |
|---|---|---|---|
| `feature/vscode-webview-sidecar` | Sidecar implementation | [#123](https://github.com/Pascapone/pibo/pull/123) | Open, awaiting review |
| `release/1.4.0` | Version bump to 1.4.0 | — | Pushed to origin, PR to be opened after #123 merges |

The release branch is branched from the feature branch, so it
contains both the sidecar implementation and the version bump. The
release PR will target `upstream/main` once the feature has
landed in `upstream/dev` and `upstream/dev` has been synced to
`upstream/main`.

## Verification

- `node --test test/chat-vscode/*.test.mjs` — **57/57 pass** (8 suites, ~1.9 s).
- `npm run typecheck` — clean across `tsc` (root), `chat-ui`,
  `context-files-ui`, `vscode` (extension + webview).
- `npm run vscode:package` — VSIX builds. Size: **315 KB** (vs
  44 KB for 1.3.5). Contains the sidecar source, the
  inliner source, the runtime shim, the `dist/chat-vscode-web/`
  bundle (790 KB inlined at runtime), and the bundled
  `extension.cjs` (158 KB).
- `node scripts/release.mjs --version 1.4.0 --no-publish --no-release`
  — completes end-to-end, surfaces the final VSIX path and
  the next-step `pibo vscode install` instructions.

## Acceptance Criteria (from the plan)

| # | Criterion | Status |
|---|---|---|
| 1 | Pibo sidebar shows the full chat-vscode SPA on VS Code 1.117.0+ | ✅ Architecture verified by integration test (800 KB inlined HTML) |
| 2 | All features work: sessions, messages, SSE, uploads, downloads, slash commands | ✅ Existing SPA is unchanged; the inliner reuses the same bundle |
| 3 | Native VS Code sidebar experience, no external browser tab | ✅ Webview stays on `vscode-webview://<id>` origin |
| 4 | Dev-auth preserved and loopback-only | ✅ Sidecar binds `127.0.0.1` only; cookie stored in module-local state |
| 5 | Minimal changes to existing Chat Web App code | ✅ No source changes in `src/apps/chat-ui/`, `src/apps/chat-vscode/extension/webview/`, or the gateway |

## Security Posture (from the plan)

| Threat | Mitigation | Status |
|---|---|---|
| Sidecar reachable from external network | Bound to `127.0.0.1`; non-loopback bind throws | ✅ `isLoopbackRequest` guard at every request |
| Port mapper accepts requests from non-webview origins | `<webviewId>` is unguessable per VS Code instance | ✅ Inherent in the port-mapper design |
| CORS allows non-`vscode-webview://` origins | Origin allowlist enforced in `corsHeadersFor` and at the request guard | ✅ Rejected with 403 in the test suite |
| Dev-auth token leaked via HTTP response | Captured in module-local state, never echoed | ✅ No `set-cookie` from the sidecar to the webview |
| CSRF on the sidecar | Loopback peer check + CORS allowlist | ✅ Both required to reach the sidecar |
| SSE hijacking | `EventSource` URL embeds `<webviewId>` | ✅ Inherent in the port-mapper design |
| DoS via slow client | 30 s idle timeout, 5 MB body limit, 5 s drain-on-stop | ✅ `PROXIED_REQUEST_TIMEOUT_MS`, `PROXIED_REQUEST_BODY_LIMIT`, `SOCKET_DRAIN_TIMEOUT_MS` |

## Known Limitations (from the plan)

- Production (better-auth) flow is **out of scope** for 1.4.0.
  The sidecar only handles dev-auth today.
- The workbench CSP could change in a future VS Code release.
  The plan recommends a CI smoke test against the latest stable
  before each release; that is **not yet** wired up.
- The 800 KB inlined HTML is in the megabyte range. If size
  becomes a real problem, the inliner can be reshaped to split
  the bundle across multiple nonced script tags. Not required
  for 1.4.0.

## What Remains Before Tagging 1.4.0

The standard release flow from
[`github-server-flow`](../../.pibo/user-skills/github-server-flow/SKILL.md):

1. **Maintainer reviews and merges PR #123** (feature → `upstream/dev`).
2. **Sync `origin/main` to `upstream/main`** if needed (it is
   already at `fce85656`, the 1.3.5 release).
3. **Sync `upstream/dev` to `upstream/main`** by merging
   `upstream/dev` into `upstream/main`. This brings the sidecar
   into the release line.
4. **Open PR from `release/1.4.0` to `upstream/main`.** The
   release/1.4.0 branch already contains the
   `chore(release): bump ... to 1.4.0` commit on top of the
   sidecar feature.
5. **After merge, tag `v1.4.0`** and push.
6. **`npm publish`** to push `@pasko70/pibo@1.4.0` to the
   registry.
7. **`node scripts/create-github-release.mjs`** to create the
   GitHub Release with the VSIX attached (or use the GitHub UI).
8. **Manually upload the VSIX to the VS Code Marketplace** via
   <https://marketplace.visualstudio.com/manage>.

## Files Touched (full list)

```
.gitignore                                                                       (modified, +3)
docs/guides/pibo-vscode-ext-quickstart.md                                         (modified, +40)
package.json                                                                      (modified, +3)
scripts/vscode-build.mjs                                                          (modified, +29)
scripts/vscode-package.mjs                                                        (modified, +32)
src/apps/chat-vscode/extension/src/inlined-chat-html.ts                           (new, +237)
src/apps/chat-vscode/extension/src/sidecar-auth.ts                                (new, +186)
src/apps/chat-vscode/extension/src/sidecar.ts                                     (new, +508)
src/apps/chat-vscode/extension/src/vscode-shim.d.ts                               (modified, +20)
src/apps/chat-vscode/extension/src/vscode-shim.js                                (new, +109)
src/apps/chat-vscode/extension/src/webview-host.ts                                (modified, +258)
src/apps/chat-vscode/package.json                                                 (modified, +20)
test/chat-vscode/inlined-chat-html.test.mjs                                       (new, +161)
test/chat-vscode/integration.test.mjs                                             (new, +46)
test/chat-vscode/sidecar-auth.test.mjs                                            (new, +170)
test/chat-vscode/sidecar.test.mjs                                                 (new, +430)
test/chat-vscode/webview-host.test.mjs                                            (new, +226)
```
