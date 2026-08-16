# Runtime Auth Control Plane Validation

**Date:** 2026-08-16  
**Branch:** `feature/agent-runtime-auth-control-plane`  
**Dependency:** `feature/agent-runtime-integrated-validation` / PR #503  
**Result:** **PASS for implementation, local verification, exact-candidate Pibo2 activation, and public-Web login readiness.** Native Codex remains intentionally disconnected; the remaining gate is the authorized user's managed login and subsequent bounded production-provider turn.

## Exact candidate

| Artifact | Exact value |
|---|---|
| Code commit | `cc0dcde6616dcec6a8dcf7cd0f78e70478a8ab1c` |
| Package | `@pasko70/pibo@1.7.2` |
| Package SHA-256 | `4cabc5f1687381fa1b5be8c094b5893d71686309d45c2195c34968af8fb117f5` |
| Package size / entries | 3,300,194 bytes / 789 entries |
| Pibo2 candidate | `agent-runtime-auth-control-plane` |
| Codex App Server | `0.147.0` |

## Defect correction

The integrated runtime stack still routed Chat Web provider-auth actions directly to Pi credential helpers before resolving a configured runtime. Native Codex therefore could not be authenticated from Pibo's product UI, Pi's shared store could be mistaken for global runtime auth, and missing runtime status could be interpreted as authenticated in model surfaces.

The correction introduces a runtime-neutral provider-auth control plane:

- Pibo-owned capability, provider, flow, status, target, input, result, and safe-error contracts;
- evidence-backed adapter method registration and bounded result validation;
- explicit configured-runtime routing in the registry, router, channel context, and authenticated Web API;
- Pi SDK auth behind the Pi adapter with truthful `adapter-shared` scope;
- official Codex App Server `0.147.0` account operations in each configured instance's private `CODEX_HOME`;
- per-runtime Provider Settings, active-runtime Terminal login, and auth-aware model/Designer rendering;
- credential-scope-aware cached-session recycling after terminal mutations.

## Deterministic adapter matrix

### Runtime contract and routing

`test/agent-runtime-auth.test.mjs` proves:

- capability shape and adapter-method consistency;
- required disposal for non-immediate flows;
- explicit configured-instance dispatch;
- unsupported operations and mismatched provider/result failures;
- bounded API-key/completion inputs and provider catalogs;
- stripping of adapter-private fields and safe error redaction.

`test/runtime-routed-session.test.mjs` proves:

- session-bound login/model actions use the frozen runtime;
- auth-required status failure does not default models to authenticated;
- a terminal `adapter-shared` mutation recycles sessions for every configured instance using that adapter.

### Pi compatibility

`test/login-actions.test.mjs` proves:

- the existing OpenAI device flow, token exchange, account-id persistence inside Pi's own store, and status behavior remain intact;
- browser PKCE continues through the Pi adapter using an opaque Pibo flow id;
- API-key setup, status, logout, and shared-store behavior remain compatible;
- conflicting same-provider flows across Pi instances are rejected and shared-scope logout cancels pending flows;
- public adapter results omit native state, verifiers, account identifiers, and credential values.

Generic Chat Web, router, registry, and product modules contain no Pi `AuthStorage` import. The deprecated `src/auth/login-actions.ts` surface is a Pi-specific compatibility re-export.

### Native Codex official account protocol

`test/codex-native-auth.test.mjs` drives a deterministic App Server `0.147.0` fixture through the same stdio JSON-RPC client/process boundary and proves:

- `account/read` disconnected and persisted connected state;
- `account/login/start` with `chatgptDeviceCode` and notification completion;
- `account/login/start` with `apiKey` without response/file echo in Pibo-owned artifacts;
- `account/login/cancel`, including preservation of a previously configured account;
- `account/logout` and post-logout verification;
- malformed response, provider failure, process crash, status timeout, login timeout, and redaction paths;
- auth-controller reuse after router disposal and persistence through a new registry/process;
- two configured Codex instances with isolated homes/accounts;
- no mutation of Pi's store or a decoy global `CODEX_HOME`.

Only stable managed methods are used. Pibo does not use `chatgptAuthTokens`, copy local OAuth files, or inject browser cookies/tokens.

### Product API and UI

`test/web-channel.test.mjs`, `test/chat-ui-provider-auth-methods.test.mjs`, Chat UI typecheck, and production builds prove:

- authenticated `GET/POST /api/chat/provider-auth` catalog and mutation paths;
- explicit runtime/provider targeting, pending polling, completion, logout, partial aggregation, and target conflict rejection;
- product-scoped auth does not append Pibo Session execution events;
- API-key request values are absent from responses;
- no hard-coded global Provider Settings list;
- connected, disconnected, pending, partial, unsupported, and failed target/provider rendering;
- target-specific credential-scope and success text;
- failed auth can be reset, API-key fields are non-echoing password inputs, and local key state is cleared after save/cancel;
- missing auth disables model choices and never defaults an auth-requiring runtime to connected.

## Local verification

Final local checks on 2026-08-16:

- `NODE_OPTIONS=--max-old-space-size=1200 npm run typecheck` — pass;
- `npm run build` — pass;
- focused runtime/Pi/Codex/Web/UI/skill tests — pass;
- canonical `npm test` — **1,752/1,752 tests across 12 suites**, zero failures, cancellations, skips, or todos;
- `git diff --check` — pass;
- `npm pack --dry-run --json` — package `@pasko70/pibo@1.7.2`, 789 files, 3,300,194-byte archive estimate, 12,578,341 bytes unpacked;
- package inventory includes the runtime auth, Pi auth, native-Codex auth, provider-auth action, and updated adapter-authoring skill JavaScript/assets.

## Security and evidence boundary

- Native login ids, separate OAuth state/verifier fields, access/refresh/ID tokens, API keys, cookies, authorization headers, account identifiers, and credential paths/content are absent from Pibo-owned public auth types.
- Interactive flows expose only the bounded authorization/verification URL, optional one-time user code, instructions, and opaque Pibo flow id required by the user.
- No active-flow URL or one-time code is included in screenshots or this report.
- Native Codex credentials persist only through the official App Server in the selected configured instance's private home.
- Pi credentials retain their existing adapter-shared store; Pibo does not copy them into Codex.
- Auth mutations preserve Pibo Session identity/bindings and recycle only sessions affected by the declared credential scope.

## Exact Pibo2 readiness validation

The exact package checksum was installed under the versioned Pibo2 candidate directory and activated through `pibo-web.service`. Post-activation evidence:

- service active on the exact candidate commit with zero restart count;
- local health returned `ok`; public `/apps/chat` returned HTTP 200 in approximately 34 ms total;
- authenticated `GET /api/chat/provider-auth` returned HTTP 200 in 224.1 ms;
- default `pi` target reported `adapter-shared` and partial aggregate state (36 discovered providers, two configured) without exposing account identifiers;
- `codex-native` reported `runtime-instance`, one `openai-codex` provider, `disconnected`, zero configured providers, Device code (`notification`) and API key (`immediate`) methods;
- rendered Provider Settings showed the private native-Codex target, disconnected state, and enabled Device code/API key controls;
- the Refresh control completed and retained the same disconnected state and controls;
- browser console contained zero warnings/errors;
- [`assets/runtime-auth-provider-settings-ready-2026-08-16.png`](./assets/runtime-auth-provider-settings-ready-2026-08-16.png) captures only the safe disconnected native-Codex target/card—no account identity, URL, one-time code, or credential material.

The provider-status read exercised official App Server `account/read` in the private runtime home. Cleanup/state checks after repeated UI/API reads showed:

- zero active Codex App Server processes;
- zero generated runtime-auth session entries;
- no private native-Codex auth file;
- private runtime home mode `0700`;
- no `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN` service environment keys;
- zero files in global Codex state;
- database inventory remained 473 sessions / 473 runtime bindings with integrity `ok`.

No login flow was started. Native Codex is ready for the user but remains unauthenticated.

## Remaining validation

1. Push the focused branch and open its stacked PR without merge, release, publication, or production deployment.
2. The authorized user opens `/apps/chat/settings/providers`, selects **Native Codex App Server**, and clicks **Device code** (or supplies an API key intentionally).
3. After managed login, verify safe `account/read` metadata without account identifiers and run one bounded public native-Codex production-provider turn.
4. Only then close REQ-015/REQ-017 and mark the overall multi-runtime goal complete.
